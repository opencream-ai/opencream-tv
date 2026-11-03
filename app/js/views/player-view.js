/* Movie / episode playback: progress banner, seeking, resume points, next episode,
   and the Audio & Subtitles menu (Down key).

   Audio choices come from two places, shown as one list:
   - tracks inside the file (instant switch), from Samsung's player;
   - the same title in another language or in 4K elsewhere in the catalogue, matched by its TMDB id
     through the search index (switching reopens the stream at the same minute).
   Subtitles are the text tracks inside the file. The chosen language is remembered. */
(function () {
    'use strict';

    window.Views = window.Views || {};

    var p, el, osdTimer, saveTimer, lastTime = 0, seekTarget = null, seekTimer, failovers = 0;
    var subTimer, subIndex = -1, menu = null;

    // ---------- languages ----------

    var ISO3 = {
        fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', eng: 'en', spa: 'es', ita: 'it', por: 'pt', dut: 'nl', nld: 'nl',
        tur: 'tr', ara: 'ar', pol: 'pl', rus: 'ru', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', swe: 'sv', dan: 'da',
        nor: 'no', fin: 'fi', gre: 'el', ell: 'el', hin: 'hi', per: 'fa', fas: 'fa', alb: 'sq', sqi: 'sq'
    };
    var NAMES = { de: 'Deutsch', fr: 'Français', en: 'English', es: 'Español', it: 'Italiano', pt: 'Português', nl: 'Nederlands' };
    var ORDER = ['de', 'fr', 'en', 'es'];

    function code(l) {
        l = String(l || '').toLowerCase().split(/[-_]/)[0];
        if (!l || l === 'und' || l === 'unk') return '';
        return ISO3[l] || (l.length === 2 || l.length === 3 ? l : '');
    }

    function langName(c) {
        if (!c) return 'Unknown language';
        if (NAMES[c]) return NAMES[c];
        try {
            // Other languages in English ("Telugu", "Hindi"): native scripts are unreadable here.
            var n = new Intl.DisplayNames(['en'], { type: 'language' }).of(c);
            if (n && n !== c) return n.charAt(0).toUpperCase() + n.slice(1);
        } catch (e) { /* older runtime */ }
        return c.toUpperCase();
    }

    function rank(c) { var i = ORDER.indexOf(c); return i < 0 ? 99 : i; }

    // ---------- resume points ----------

    function save() {
        if (!p || !lastTime) return;
        Store.saveResume({
            key: p.key, title: p.title, sub: p.sub, poster: p.poster,
            pos: lastTime, dur: Player.duration(), params: Object.assign({}, p, { startMs: lastTime })
        });
    }

    // ---------- on-screen banner ----------

    function paint() {
        var dur = Player.duration();
        var t = seekTarget != null ? seekTarget : lastTime;
        var pct = dur ? Math.min(100, t / dur * 100) : 0;
        el.querySelector('.ptitle').textContent = p.title;
        el.querySelector('.psub').textContent = p.sub || '';
        el.querySelector('.pbar i').style.width = pct + '%';
        el.querySelector('.pel').textContent = UI.duration(t);
        el.querySelector('.prem').textContent = dur ? '-' + UI.duration(Math.max(0, dur - t)) : '';
        el.querySelector('.pstate').innerHTML = Player.isPaused() ? Icons.play : Icons.pause;
        el.querySelector('.plang').textContent = currentLabel();
    }

    function showOsd(sticky) {
        paint();
        var o = el.querySelector('.posd');
        o.classList.add('show');
        el.classList.add('osd-on');
        clearTimeout(osdTimer);
        if (!sticky && !Player.isPaused() && !menu) {
            osdTimer = setTimeout(hideOsd, 4000);
        }
    }

    function hideOsd() {
        if (menu || Player.isPaused()) return;
        el.querySelector('.posd').classList.remove('show');
        el.classList.remove('osd-on');
    }

    // Repeated presses add up; the jump happens once the presses stop.
    // Holding the key (or pressing it again and again) makes the steps bigger the longer it goes on,
    // so a whole film can be crossed in a few seconds (03.11.2026).
    var LADDER = [[1500, 10000], [3000, 30000], [5000, 60000], [8000, 120000], [Infinity, 300000]];

    function stepFor(heldMs, minMs) {
        var step = minMs;
        for (var i = 0; i < LADDER.length; i++) {
            if (heldMs < LADDER[i][0]) { step = Math.max(minMs, LADDER[i][1]); break; }
        }
        // Short episodes: never more than a twentieth of the length per step.
        var dur = Player.duration();
        if (dur) step = Math.min(step, Math.max(minMs, Math.round(dur / 20 / 10000) * 10000));
        return step;
    }

    function nudge(dir, minMs, heldMs) {
        var step = stepFor(heldMs || 0, minMs);
        var base = seekTarget != null ? seekTarget : lastTime;
        var dur = Player.duration();
        seekTarget = Math.max(0, dur ? Math.min(base + dir * step, dur - 2000) : base + dir * step);
        showOsd();
        clearTimeout(seekTimer);
        seekTimer = setTimeout(function () {
            Player.seek(seekTarget - Player.time());
            lastTime = seekTarget;
            seekTarget = null;
        }, 600);
    }

    // ---------- subtitles ----------

    function showSubtitle(s) {
        var box = el && el.querySelector('.psubs');
        if (!box) return;
        clearTimeout(subTimer);
        // Strip markup the stream may carry (<i>, <font>), keep line breaks.
        var text = String(s.text || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
        box.innerHTML = text ? '<span>' + UI.esc(text).replace(/\n/g, '<br>') + '</span>' : '';
        if (text && s.ms > 0) subTimer = setTimeout(function () { box.innerHTML = ''; }, s.ms);
    }

    // ---------- playback ----------

    // Build the stream URL for a descriptor ({type,id,container}); returns a Promise.
    function streamFor(entry) {
        if (entry.type === 'series') return Xtream.episodeUrl({ id: entry.id, container_extension: entry.container });
        return Xtream.movieUrl({ stream_id: entry.id, container_extension: entry.container });
    }

    function start(params) {
        p = params;
        lastTime = params.startMs || 0;
        subIndex = -1;
        showSubtitle({ text: '' });
        var mine = p;
        showOsd(true);
        streamFor(params).then(function (url) {
            if (p !== mine) return; // moved to another title meanwhile
            Player.play(url, { startMs: params.startMs || 0 });
        }).catch(function (e) {
            if (p !== mine) return;
            Log.error('no stream for ' + params.title + ': ' + e.message);
            UI.toast('This title is not available right now');
        });
        showOsd();
    }

    // Once playing: pick the remembered audio language and subtitles if this file has them.
    function applyPreferences() {
        var tr = Player.tracks();
        if (tr.audio.length || tr.text.length) {
            Log.info('tracks: audio ' + tr.audio.map(function (a) { return (a.lang || '?') + (a.channels ? '/' + a.channels + 'ch' : '') + (a.current ? '*' : ''); }).join(' ') +
                ' · subtitles ' + (tr.text.map(function (t) { return t.lang || '?'; }).join(' ') || 'none'));
        }
        // Remembered language first; otherwise the language of the catalogue entry, because some
        // files start on another track (an "EN" movie that opens in Telugu, 31.10.2026).
        var ap = Store.get('audioPref', '') || titleLang();
        if (ap && tr.audio.length > 1) {
            var cur = tr.audio.filter(function (a) { return a.current; })[0];
            if (!cur || code(cur.lang) !== ap) {
                var want = tr.audio.filter(function (a) { return code(a.lang) === ap; })
                    .sort(function (a, b) { return b.channels - a.channels; })[0]; // prefer 5.1
                if (want) Player.selectAudio(want.index);
            }
        }
        var sp = Store.get('subPref', 'off');
        var sub = sp === 'off' ? null : tr.text.filter(function (t) { return code(t.lang) === sp; })[0];
        if (sub) { Player.selectText(sub.index); subIndex = sub.index; } else if (tr.text.length) { Player.selectText(-1); }
        if (el) paint();
    }

    function next() {
        if (!p.queue || p.qi + 1 >= p.queue.length) return false;
        start(Object.assign({}, p.queue[p.qi + 1], { startMs: 0, queue: p.queue, qi: p.qi + 1 }));
        return true;
    }

    function leave() {
        save();
        App.back();
    }

    // ---------- Audio & Subtitles ----------

    // Versions of the playing title in the catalogue (needs the search index).
    function catalogueVersions() {
        if (!window.Search || !Search.versions) return [];
        if (p.type === 'movie') return Search.versions('movie', p.id, p.tmdb);
        if (p.seriesId) return Search.versions('series', p.seriesId, p.tmdb);
        return [];
    }

    function titleLang() {
        var me = catalogueVersions().filter(function (v) { return String(v.id) === String(selfId()); })[0];
        if (me && me.l) return me.l;
        var m = /^\s*(?:4K\s*-?\s*)?(FR|DE|EN|ES)\s*-/i.exec(p.title || '');
        return m ? m[1].toLowerCase() : '';
    }

    function selfId() { return p.type === 'movie' ? p.id : p.seriesId; }

    function options() {
        var tr = Player.tracks();
        var vers = catalogueVersions();
        var me = vers.filter(function (v) { return String(v.id) === String(selfId()); })[0];
        var myLang = me ? me.l : '', myQ = me ? (me.q || '') : '';

        var audio = [];
        tr.audio.forEach(function (t) {
            var c = code(t.lang) || (tr.audio.length === 1 ? myLang : '');
            audio.push({
                kind: 'track', index: t.index, lang: c, current: t.current || tr.audio.length === 1,
                label: langName(c) + (myQ ? ' 4K' : ''), note: t.channels >= 6 ? '5.1' : ''
            });
        });
        if (!audio.length) audio.push({ kind: 'self', lang: myLang, current: true, label: myLang ? langName(myLang) + (myQ ? ' 4K' : '') : 'Original', note: '' });

        var have = {};
        audio.forEach(function (a) { have[a.lang + '|' + myQ] = true; });
        vers.filter(function (v) { return String(v.id) !== String(selfId()) && v.l; })
            .sort(function (a, b) { return rank(a.l) - rank(b.l) || (a.q ? -1 : 0) - (b.q ? -1 : 0); })
            .forEach(function (v) {
                var key = v.l + '|' + (v.q || '');
                if (have[key]) return;
                have[key] = true;
                audio.push({ kind: 'version', v: v, lang: v.l, current: false, label: langName(v.l) + (v.q ? ' 4K' : ''), note: '' });
            });

        // Two tracks in the same language: tell them apart by channels.
        audio.forEach(function (a) {
            var same = audio.filter(function (b) { return b.label === a.label; });
            if (same.length > 1 && a.kind === 'track' && !a.note) a.note = 'Stereo';
        });

        var subs = [{ kind: 'off', label: 'Off', current: subIndex < 0, note: '' }];
        tr.text.forEach(function (t, n) {
            var c = code(t.lang);
            subs.push({ kind: 'text', index: t.index, lang: c, label: c ? langName(c) : 'Subtitles ' + (n + 1), current: t.index === subIndex, note: '' });
        });
        number(audio);
        number(subs);
        return { audio: audio, subs: subs };
    }

    // Entries that still look identical get a number: "Français", "Français 2".
    function number(list) {
        var seen = {};
        list.forEach(function (x) {
            var k = x.label + '|' + x.note;
            seen[k] = (seen[k] || 0) + 1;
            if (seen[k] > 1) x.label += ' ' + seen[k];
        });
    }

    function currentLabel() {
        if (!p) return '';
        var o;
        try { o = options(); } catch (e) { return ''; }
        var a = o.audio.filter(function (x) { return x.current; })[0];
        var s = o.subs.filter(function (x) { return x.current; })[0];
        var al = a ? a.label + (a.note ? ' ' + a.note : '') : '';
        if (o.subs.length < 2) return al;
        return al + (s && s.kind !== 'off' ? ', subtitles ' + s.label : ', no subtitles');
    }

    function openMenu() {
        var o = options();
        var ai = Math.max(0, o.audio.findIndex(function (x) { return x.current; }));
        var si = Math.max(0, o.subs.findIndex(function (x) { return x.current; }));
        menu = { o: o, col: 0, idx: [ai, si] };
        clearTimeout(osdTimer);
        showOsd(true);
        renderMenu();
    }

    function closeMenu() {
        menu = null;
        var m = el.querySelector('.pmenu');
        m.classList.remove('show');
        el.querySelector('.pbtn').classList.remove('focus');
        showOsd();
    }

    function renderMenu() {
        var m = el.querySelector('.pmenu');
        var ROWS = 8;
        var col = function (title, list, c) {
            // Long lists (some files carry 30 subtitle tracks) show a window around the focus.
            var from = Math.max(0, Math.min(menu.idx[c] - 3, list.length - ROWS));
            var shown = list.slice(from, from + ROWS);
            return '<div class="pcol' + (menu.col === c ? ' active' : '') + '"><div class="pcolh">' + title +
                (list.length > ROWS ? '<span class="pcount">' + (menu.idx[c] + 1) + ' of ' + list.length + '</span>' : '') + '</div>' +
                shown.map(function (x, j) {
                    var i = from + j;
                    return '<div class="popt' + (menu.col === c && menu.idx[c] === i ? ' focus' : '') + (x.current ? ' on' : '') + '">' +
                        '<span class="pchk">' + (x.current ? Icons.check : '') + '</span>' +
                        '<span class="plbl">' + UI.esc(x.label) + '</span>' +
                        (x.note ? '<span class="pnote">' + UI.esc(x.note) + '</span>' : '') + '</div>';
                }).join('') + '</div>';
        };
        m.innerHTML = col('Audio', menu.o.audio, 0) + col('Subtitles', menu.o.subs, 1) +
            (menu.o.subs.length < 2 ? '<div class="pnone">This file has no subtitles</div>' : '');
        m.classList.add('show');
        el.querySelector('.pbtn').classList.add('focus');
    }

    function choose() {
        var list = menu.col === 0 ? menu.o.audio : menu.o.subs;
        var x = list[menu.idx[menu.col]];
        if (!x || x.current) { closeMenu(); return; }
        if (x.kind === 'track') {
            if (Player.selectAudio(x.index)) Store.set('audioPref', x.lang);
        } else if (x.kind === 'version') {
            Store.set('audioPref', x.lang);
            closeMenu();
            switchVersion(x);
            return;
        } else if (x.kind === 'off') {
            Player.selectText(-1); subIndex = -1; Store.set('subPref', 'off');
        } else if (x.kind === 'text') {
            if (Player.selectText(x.index)) { subIndex = x.index; Store.set('subPref', x.lang || 'off'); }
        }
        // Re-read what the player now reports so the ticks are true.
        setTimeout(function () {
            if (!menu) return;
            menu.o = options();
            renderMenu();
            paint();
        }, 300);
    }

    // Reopen the same minute in another version of the title.
    function switchVersion(x) {
        var v = x.v, at = lastTime;
        save();
        UI.toast(x.label + '...');
        Log.info('switch to ' + x.label + ' (' + v.t + ' ' + v.id + ')');
        if (p.type === 'movie') {
            start(Object.assign({}, p, { id: v.id, container: v.x || 'mkv', tmdb: v.m || p.tmdb, startMs: at }));
            return;
        }
        // Series: find the same season and episode in the other series.
        Xtream.seriesInfo(v.id).then(function (info) {
            var eps = (info && info.episodes && info.episodes[p.season]) || [];
            var hit = -1;
            for (var i = 0; i < eps.length; i++) if (String(eps[i].episode_num) === String(p.ep)) { hit = i; break; }
            if (hit < 0) { UI.toast('This episode is not available in ' + x.label); return; }
            var queue = eps.map(function (ep) {
                return {
                    type: 'series', id: ep.id, container: ep.container_extension || 'mp4',
                    seriesId: v.id, tmdb: v.m || p.tmdb, season: p.season, ep: ep.episode_num,
                    title: p.title, sub: 'S' + p.season + ' E' + ep.episode_num + ' · ' + Xtream.clean(ep.title || ''),
                    poster: p.poster, key: 'e' + ep.id
                };
            });
            // Keep the resume point of the episode we came from.
            var now = Object.assign({}, queue[hit], { key: p.key, startMs: at, queue: queue, qi: hit });
            start(now);
        }).catch(function () { UI.toast(x.label + ' could not be opened'); });
    }

    function menuKey(a) {
        var list = menu.col === 0 ? menu.o.audio : menu.o.subs;
        switch (a.type) {
            case 'up': if (menu.idx[menu.col] > 0) menu.idx[menu.col]--; break;
            case 'down': if (menu.idx[menu.col] < list.length - 1) menu.idx[menu.col]++; break;
            case 'left': menu.col = 0; break;
            case 'right': if (menu.o.subs.length > 1) menu.col = 1; break;
            case 'ok': choose(); return true;
            case 'back': case 'info': closeMenu(); return true;
            case 'stop': closeMenu(); leave(); return true;
        }
        renderMenu();
        return true;
    }

    window.Views.player = {
        mount: function (root, params) {
            menu = null;
            el = document.createElement('div');
            el.className = 'player';
            el.innerHTML = '<div class="spinner"></div><div class="psubs"></div>' +
                '<div class="pmenu"></div>' +
                '<div class="posd">' +
                '<div class="phead"><span class="pstate"></span><div class="ptxt"><div class="ptitle"></div><div class="psub"></div></div></div>' +
                '<div class="pbar"><i></i></div>' +
                '<div class="prow"><span class="pel"></span><span class="prem"></span>' +
                '<span class="pbtn">' + Icons.subtitles + '<span class="plang"></span></span></div>' +
                '</div>';
            root.appendChild(el);
            var spin = el.querySelector('.spinner');
            Player.on({
                buffering: function (on) { spin.classList.toggle('show', on); },
                time: function (ms) { if (ms > 0) { lastTime = ms; failovers = 0; } },
                ready: function () { setTimeout(applyPreferences, 400); },
                subtitle: showSubtitle,
                ended: function () {
                    Store.saveResume({ key: p.key, pos: 0 }); // finished: drop the resume point
                    if (!next()) App.back();
                },
                error: function () {
                    // Try the title on the next server (resume where it stopped), then give up.
                    if (Xtream.nextStreamServer(failovers)) {
                        failovers++;
                        setTimeout(function () { start(Object.assign({}, p, { startMs: lastTime })); }, 1500);
                        return;
                    }
                    failovers = 0;
                    spin.classList.remove('show');
                    UI.toast('This title could not be played');
                }
            });
            start(params);
            saveTimer = setInterval(save, 10000);
        },
        unmount: function () {
            clearInterval(saveTimer); clearTimeout(osdTimer); clearTimeout(seekTimer); clearTimeout(subTimer);
            menu = null;
            Player.stop();
            Player.on(null);
        },
        onHide: save,
        onShow: function () {
            start(Object.assign({}, p, { startMs: lastTime }));
        },
        onKey: function (a) {
            if (menu) return menuKey(a);
            switch (a.type) {
                case 'ok': case 'playPause': case 'play': case 'pause':
                    if (a.type === 'play' && !Player.isPaused()) break;
                    if (a.type === 'pause' && Player.isPaused()) break;
                    Player.toggle();
                    showOsd(Player.isPaused());
                    break;
                case 'left': nudge(-1, 10000, a.heldMs); break;
                case 'right': nudge(1, 10000, a.heldMs); break;
                case 'rw': nudge(-1, 60000, a.heldMs); break;
                case 'ff': nudge(1, 60000, a.heldMs); break;
                case 'chUp': if (!next()) UI.toast('Last episode'); break;
                case 'down': openMenu(); break;
                case 'up': case 'info': showOsd(); break;
                case 'stop': case 'back': leave(); break;
            }
            return true;
        }
    };
})();
