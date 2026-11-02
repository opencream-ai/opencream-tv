/* Search index across Live TV, Movies and Series, kept on the TV (IndexedDB).
   The provider has no search API and its full lists are far too large to download per search,
   so the index is built in the background: channels hourly (event channels are renamed daily),
   movies and series once a day, one category at a time. Respects the language/adult filters. */
(function () {
    'use strict';

    var LIVE_TTL = 3600e3, LIBRARY_TTL = 24 * 3600e3, EPG_TTL = 8 * 3600e3;
    var data = { live: [], movie: [], series: [], epg: [] };
    var stamp = { live: 0, movie: 0, series: 0, epg: 0 };
    var progress = { live: 1, movie: 1, series: 1, epg: 1 };
    var building = false, db = null, pausedUntil = 0;

    // ---------- tiny IndexedDB key-value store ----------

    function openDb() {
        if (db) return Promise.resolve(db);
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('opencreamtv', 1);
                req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
                req.onsuccess = function () { db = req.result; resolve(db); };
                req.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }

    function idb(mode, fn) {
        return openDb().then(function (d) {
            if (!d) return null;
            return new Promise(function (resolve) {
                var tx = d.transaction('kv', mode);
                var req = fn(tx.objectStore('kv'));
                tx.oncomplete = function () { resolve(req && req.result); };
                tx.onerror = function () { resolve(null); };
            });
        });
    }

    function load(kind) { return idb('readonly', function (s) { return s.get(kind); }); }
    function save(kind) {
        // The sample catalogue is indexed in memory only: it must never replace the stored index.
        if (Xtream.isDemo()) return Promise.resolve();
        return idb('readwrite', function (s) { return s.put({ at: stamp[kind], items: data[kind], filter: filterKey(kind) }, kind); });
    }

    // ---------- building ----------

    // Lower case, no accents, punctuation as spaces, with a leading space so " word" finds word starts.
    function norm(s) {
        return ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ').trim();
    }

    // Adult titles are always indexed (marked) and hidden at search time, so entering the PIN
    // does not trigger a full rebuild (that burst got the account throttled, 31.10.2026).
    // The chosen countries (live) and languages (movie/series) are part of each list's key, so a
    // change rebuilds only that list. Never change the 'v3' part: it would rebuild everything.
    function filterKey(kind) { return 'v3:' + (Lang.allLanguages() ? 'all' : 'some') + Lang.filterSuffix(kind); }

    function entry(t, id, name, cat, icon, ext) {
        var n = Xtream.clean(name);
        return { t: t, id: id, n: n, k: norm(n), c: cat, i: icon || '', x: ext || '' };
    }

    // Language of a movie/series: the name prefix ("FR - ", "4K-EN - ") wins, else the group's language.
    var PREFIX_LANG = { FR: 'fr', QC: 'fr', DE: 'de', ES: 'es', LA: 'es', EN: 'en', UK: 'en', US: 'en' };
    function langOfTitle(name, catName) {
        var m = /^\s*(?:4K\s*-?\s*)?([A-Z]{2})\s*[-|:]/.exec(String(name || '').toUpperCase());
        if (m && PREFIX_LANG[m[1]]) return PREFIX_LANG[m[1]];
        var l = Lang.langOf(catName);
        return l === 'other' || l === 'any' ? '' : l;
    }
    function is4k(name, catName) { return /(^|[^A-Z0-9])4K|UHD|3840|⁴ᴷ|ᵁᴴᴰ/i.test(String(name) + ' ' + String(catName)); }

    // Movie/series fields used to find the same title in other languages (see versions()).
    function withIds(e, m, c) {
        var tm = m.tmdb != null ? String(m.tmdb) : '';
        if (tm && tm !== '0') e.m = tm;
        e.l = langOfTitle(m.name, c.category_name);
        if (is4k(m.name, c.category_name)) e.q = '4k';
        return e;
    }

    function buildLive() {
        progress.live = 0;
        return Xtream.liveCategories().then(function (cats) {
            var keep = {};
            cats.forEach(function (c) {
                var m = /^\s*([^|]{1,12})\|/.exec(c.category_name);
                var code = m ? m[1].trim().toUpperCase() : 'OTHER';
                if (Lang.isAdult(c.category_name)) keep[c.category_id] = 'adult';
                else if (Lang.keepCountry(code)) keep[c.category_id] = true;
            });
            // One request for every channel (about 20 MB): cheaper than hundreds of group requests.
            return Xtream.raw({ action: 'get_live_streams' }, 120000).then(function (all) {
                data.live = (all || []).filter(function (s) {
                    return keep[s.category_id] && !/^[#=*\-_~\s]{2,}/.test(s.name || '');
                }).map(function (s) {
                    var e = entry('live', s.stream_id, s.name, s.category_id, s.stream_icon);
                    if (keep[s.category_id] === 'adult') e.a = 1;
                    e.g = s.epg_channel_id || '';  // programme guide id (see buildEpg)
                    return e;
                });
                stamp.live = Date.now();
                progress.live = 1;
                Log.info('search index: ' + data.live.length + ' channels');
                return save('live');
            });
        });
    }

    function buildLibrary(kind) {
        var catsCall = kind === 'movie' ? Xtream.vodCategories : Xtream.seriesCategories;
        var action = kind === 'movie' ? 'get_vod_streams' : 'get_series';
        progress[kind] = 0;
        return catsCall().then(function (cats) {
            cats = cats.filter(function (c) { return Lang.isAdult(c.category_name) || Lang.keepCategory(c.category_name); });
            var items = [], seen = {}, i = 0;
            var step = function () {
                if (i >= cats.length) {
                    data[kind] = items;
                    stamp[kind] = Date.now();
                    progress[kind] = 1;
                    Log.info('search index: ' + items.length + ' ' + kind);
                    return save(kind);
                }
                var c = cats[i++];
                return Xtream.raw({ action: action, category_id: c.category_id }).then(function (list) {
                    (list || []).forEach(function (m) {
                        var id = kind === 'movie' ? m.stream_id : m.series_id;
                        if (seen[id]) return;
                        seen[id] = true;
                        var e = withIds(kind === 'movie'
                            ? entry('movie', id, m.name, c.category_id, m.stream_icon, m.container_extension)
                            : entry('series', id, m.name, c.category_id, m.cover), m, c);
                        if (Lang.isAdult(c.category_name)) e.a = 1;
                        items.push(e);
                    });
                }, function (e) {
                    // Every server failed (not just this category): stop the whole build instead of
                    // knocking on every server for hundreds of categories (31.10.2026, kept a
                    // provider block alive). refresh() tries again later.
                    throw e;
                }).then(function () {
                    progress[kind] = i / cats.length;
                    // Make partial results searchable while the rest loads.
                    if (i % 10 === 0) data[kind] = items.slice();
                    // Go easy on the provider: a short pause between requests, a longer one while
                    // something is playing (too many requests at once get the account throttled).
                    var pause = document.body.classList.contains('video') ? 1500 : 250;
                    return new Promise(function (r) { setTimeout(r, pause); }).then(step);
                });
            };
            return step();
        });
    }

    // ---------- programme guide (search inside what is on TV, e.g. a match) ----------
    // The provider's guide (xmltv.php) is ~70 MB for all 8000 channels and ~24 h ahead. It is read
    // as it streams in and only programmes of the indexed channels that have not ended are kept
    // (~40k programmes, ~6 MB for DE/EN/FR/ES). Never hold the whole XML in memory (31.10.2026).

    var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    function unxml(t) {
        return String(t || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (m, e) {
            if (e[0] === '#') return String.fromCharCode(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
            return ENT[e] || m;
        }).trim();
    }
    // "20261030180000 +0100" -> ms since epoch
    function xmlTime(t) {
        var m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\s*([+-])?(\d\d)?(\d\d)?/.exec(t || '');
        if (!m) return 0;
        var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        if (m[7]) ms -= (m[7] === '-' ? -1 : 1) * ((+m[8]) * 60 + (+m[9] || 0)) * 60e3;
        return ms;
    }

    // Guide sources, fastest first: the video servers (relay on the Mac / direct), then the list servers
    // (Cloudflare, slow: ~70 KB/s, ~17 min). One pass; refresh() pauses 30 min if all fail.
    function epgSources() {
        var c = Xtream.creds(), seen = {}, out = [];
        (c.streamServers || []).concat(c.servers || []).forEach(function (srv) {
            if (!seen[srv]) { seen[srv] = 1; out.push(srv); }
        });
        return out.map(function (srv) {
            return srv + '/xmltv.php?username=' + encodeURIComponent(c.user) + '&password=' + encodeURIComponent(c.pass);
        });
    }

    function buildEpg() {
        var ids = {};
        data.live.forEach(function (e) { if (e.g) ids[e.g] = 1; });
        if (!Object.keys(ids).length) return Promise.resolve();
        progress.epg = 0;
        var urls = epgSources(), t0 = Date.now();
        var tryUrl = function (i) {
            if (i >= urls.length) return Promise.reject(new Error('no guide source answered'));
            return readEpg(urls[i], ids).catch(function (e) {
                Log.info('guide source failed: ' + urls[i].replace(/\?.*/, '') + ' (' + (e && e.message) + ')');
                return tryUrl(i + 1);
            });
        };
        return tryUrl(0).then(function (items) {
            items.sort(function (a, b) { return a.s - b.s; });
            data.epg = items;
            stamp.epg = Date.now();
            progress.epg = 1;
            Log.info('search index: ' + items.length + ' programmes in ' + Math.round((Date.now() - t0) / 1000) + ' s');
            return save('epg');
        });
    }

    // Streams one guide URL. Rejects if nothing arrives within 20 s or the whole read takes over 30 min.
    function readEpg(url, ids) {
        var ctl = Net.canceller(), now = Date.now(), items = [], buf = '', bytes = 0, rd = null;
        // Stop a stalled or over-long read: abort the fetch (when supported) and cancel the reader,
        // which ends the stream even on TVs without AbortController.
        var stop = function () { ctl.abort(); if (rd) { try { rd.cancel(); } catch (e) {} } };
        var firstByte = setTimeout(stop, 20000);
        var deadline = setTimeout(stop, 30 * 60e3);
        var dec = new TextDecoder('utf-8');
        var done = function () { clearTimeout(firstByte); clearTimeout(deadline); };
        var take = function (block) {
            var head = /<programme\b([^>]*)>/.exec(block);
            if (!head) return;
            var ch = /channel="([^"]*)"/.exec(head[1]);
            if (!ch || !ids[unxml(ch[1])]) return;
            var stop = xmlTime((/stop="([^"]*)"/.exec(head[1]) || [])[1]);
            if (stop <= now) return;
            var title = unxml((/<title\b[^>]*>([\s\S]*?)<\/title>/.exec(block) || [])[1]);
            if (!title) return;
            var desc = unxml((/<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(block) || [])[1]).slice(0, 300);
            var e = { t: 'epg', n: title, k: norm(title), g: unxml(ch[1]),
                s: xmlTime((/start="([^"]*)"/.exec(head[1]) || [])[1]), e: stop };
            if (desc) e.d = norm(desc);
            items.push(e);
        };
        var opts = { cache: 'no-store' };
        if (ctl.signal) opts.signal = ctl.signal;
        return fetch(url, opts).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var total = +r.headers.get('Content-Length') || 70e6;
            rd = r.body.getReader();
            var pump = function () {
                return rd.read().then(function (x) {
                    if (x.done) return;
                    clearTimeout(firstByte);
                    bytes += x.value.length;
                    progress.epg = Math.min(0.99, bytes / total);
                    buf += dec.decode(x.value, { stream: true });
                    var at, from = 0;
                    while ((at = buf.indexOf('</programme>', from)) >= 0) {
                        take(buf.slice(buf.lastIndexOf('<programme', at), at));
                        from = at + 12;
                    }
                    buf = buf.slice(from);
                    if (buf.length > 1e6) buf = buf.slice(-2e5);  // no programme is this long: drop junk
                    return pump();
                });
            };
            return pump();
        }).then(function () {
            done();
            if (!items.length) throw new Error('guide was empty (' + bytes + ' bytes)');
            return items;
        }, function (e) { done(); throw e; });
    }

    function stale(kind) {
        // Older live entries have no guide id: refresh live once (one request), not movies/series.
        if (kind === 'live' && data.live.length && data.live[0].g === undefined) return true;
        if (kind === 'epg') return Date.now() - stamp.epg > EPG_TTL || !data.epg.length;
        return Date.now() - stamp[kind] > (kind === 'live' ? LIVE_TTL : LIBRARY_TTL);
    }

    // Load what is stored, then refresh whatever is out of date, one list at a time.
    var indexIsDemo = false;
    function refresh() {
        if (building || !Xtream.configured()) return Promise.resolve();
        // Never mix sample and real lists: switching between them starts from an empty index.
        var demo = Xtream.isDemo();
        if (demo !== indexIsDemo) { invalidate(); indexIsDemo = demo; }
        if (demo) {
            // Sample channels: a small in-memory index (no guide, nothing stored, no provider).
            if (data.live.length && data.movie.length && data.series.length) return Promise.resolve();
            building = true;
            progress.epg = 1;
            var each = function (kind, job) { return function () { return data[kind].length ? null : job(); }; };
            return Promise.resolve().then(each('live', buildLive)).then(each('movie', function () { return buildLibrary('movie'); }))
                .then(each('series', function () { return buildLibrary('series'); }))
                .then(function () { building = false; }, function (e) { building = false; Log.error('sample index failed: ' + (e && e.message)); });
        }
        building = true;
        return Promise.all(['live', 'movie', 'series', 'epg'].map(function (kind) {
            if (data[kind].length) return null;
            return load(kind).then(function (rec) {
                if (rec && rec.filter === filterKey(kind)) { data[kind] = rec.items; stamp[kind] = rec.at; }
            });
        })).then(function () {
            var chain = Promise.resolve();
            // The guide comes last, never at the same time as the other lists.
            ['live', 'movie', 'series', 'epg'].forEach(function (kind) {
                chain = chain.then(function () {
                    if (!stale(kind)) return null;
                    if (Date.now() < pausedUntil) return null;
                    var job = kind === 'live' ? buildLive() : kind === 'epg' ? buildEpg() : buildLibrary(kind);
                    return job.catch(function (e) {
                        progress[kind] = 1;
                        pausedUntil = Date.now() + 30 * 60e3;
                        Log.error('search index ' + kind + ' failed, next try in 30 min: ' + (e && e.message));
                    });
                });
            });
            return chain;
        }).then(function () { building = false; }, function () { building = false; });
    }

    // Only the given lists are out of date (countries -> live, languages -> movie + series).
    function drop(kinds) {
        kinds.forEach(function (k) { data[k] = []; stamp[k] = 0; });
    }

    // Filters changed (languages / adult): throw the index away and rebuild.
    function invalidate() {
        data = { live: [], movie: [], series: [], epg: [] };
        stamp = { live: 0, movie: 0, series: 0, epg: 0 };
    }

    // Guide id -> the channel to play: prefer a plain HD copy over 4K/backup variants.
    var chanMap = null, chanMapAt = -1, chanMapAdult = null;
    function guideChannels(adult) {
        if (chanMap && chanMapAt === stamp.live && chanMapAdult === adult) return chanMap;
        var map = {};
        data.live.forEach(function (e) {
            if (!e.g || (e.a && !adult)) return;
            var cur = map[e.g], weak = function (x) { return /4k|uhd|backup|raw|50fps|60fps/i.test(x.n); };
            if (!cur || (weak(cur) && !weak(e))) map[e.g] = e;
        });
        chanMap = map; chanMapAt = stamp.live; chanMapAdult = adult;
        return map;
    }

    // Every word must start a word in the title; channels first (live events), then movies, then series.
    function find(q, limit) {
        var adult = Lang.showAdult();
        var words = norm(q).split(' ').filter(Boolean).map(function (w) { return ' ' + w; });
        if (!words.length) return [];
        var out = [];
        var match = function (k) {
            for (var w = 0; w < words.length; w++) if (k.indexOf(words[w]) < 0) return false;
            return true;
        };
        var guide = function () {
            // Programmes: title matches first, then description matches; on now / soonest first.
            // One row per programme and channel name (HD/FHD/4K copies of a channel share a guide id).
            var chan = guideChannels(adult), now = Date.now(), seen = {}, byTitle = [], byDesc = [];
            var list = data.epg;
            for (var i = 0; i < list.length && byTitle.length < 150; i++) {
                var p = list[i];
                if (p.e <= now) continue;
                var inTitle = match(p.k);
                if (!inTitle && !(p.d && byDesc.length < 60 && match(p.d))) continue;
                var c = chan[p.g];
                if (!c) continue;
                var key = p.k + '|' + p.s + '|' + c.k;
                if (seen[key]) continue;
                seen[key] = 1;
                (inTitle ? byTitle : byDesc).push({ t: 'epg', n: p.n, s: p.s, e: p.e, ch: c });
            }
            return byTitle.concat(byDesc);
        };
        ['live', 'epg', 'movie', 'series'].forEach(function (kind) {
            if (kind === 'epg') { out = out.concat(guide()); return; }
            var list = data[kind];
            for (var i = 0; i < list.length && out.length < (limit || 300); i++) {
                var k = list[i].k, ok = true;
                for (var w = 0; w < words.length; w++) if (k.indexOf(words[w]) < 0) { ok = false; break; }
                if (ok && (!list[i].a || adult)) out.push(list[i]);
            }
        });
        return out;
    }

    // Every version of a movie or series in the index (other languages, 4K), the given one included.
    // kind: 'movie' | 'series'. Matched on the TMDB id, so translated titles are found too.
    var byTmdb = { movie: null, series: null }, byTmdbAt = { movie: -1, series: -1 }, byTmdbLen = { movie: -1, series: -1 };
    function tmdbMap(kind) {
        var list = data[kind];
        if (byTmdb[kind] && byTmdbAt[kind] === stamp[kind] && byTmdbLen[kind] === list.length) return byTmdb[kind];
        var map = { ids: {}, tm: {} };
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            map.ids[e.id] = e;
            if (e.m) (map.tm[e.m] = map.tm[e.m] || []).push(e);
        }
        byTmdb[kind] = map; byTmdbAt[kind] = stamp[kind]; byTmdbLen[kind] = list.length;
        return map;
    }
    function versions(kind, id, tmdb) {
        var map = tmdbMap(kind);
        var self = map.ids[id];
        var tm = tmdb || (self && self.m);
        if (!tm) return self ? [self] : [];
        var list = (map.tm[String(tm)] || []).slice();
        if (self && list.indexOf(self) < 0) list.unshift(self);
        return list;
    }

    function status() {
        var parts = [];
        if (progress.live < 1) parts.push('channels');
        if (progress.movie < 1) parts.push('movies ' + Math.round(progress.movie * 100) + '%');
        if (progress.series < 1) parts.push('series ' + Math.round(progress.series * 100) + '%');
        if (progress.epg < 1) parts.push('TV guide ' + Math.round(progress.epg * 100) + '%');
        var counts = data.live.length + ' channels · ' + data.movie.length + ' movies · ' + data.series.length + ' series' +
            (data.epg.length ? ' · ' + data.epg.length + ' programmes' : '');
        return parts.length ? 'Still indexing ' + parts.join(', ') + ' · ' + counts : counts;
    }

    window.Search = { refresh: refresh, invalidate: invalidate, drop: drop, find: find, status: status, versions: versions };
})();
