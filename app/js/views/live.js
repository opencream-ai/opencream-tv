/* Live TV: full-screen channel with zapping (CH +/-, digits, previous channel), an info banner
   with now/next, and a guide organised country → group → channel, plus Favourites.
   Groups are loaded one at a time: the full provider list is far too large for the TV. */
(function () {
    'use strict';

    window.Views = window.Views || {};

    var FAV = 'fav';
    var COUNTRY_NAMES = Lang.COUNTRY_NAMES;

    // Survives leaving and re-entering the screen.
    var countries = [], groups = [];
    var ADULT = '18+';
    var playing = { group: null, groupName: '', channels: [], idx: -1 };
    var previous = null;
    var failovers = 0, tunedAt = 0, quickEnds = 0;

    var el, osdEl, guideEl, numEl, spinEl, countryList, groupList, chanList, previewEl;
    var guideOpen = false, guideCol = 'chans', browse = { group: null, groupName: '', channels: [] };
    var osdTimer, zapTimer, numTimer, colTimer, previewTimer, numBuf = '';

    // Country order in the guide: the order chosen in Settings.
    function preferred() { return Lang.countries(); }

    function loadGroups() {
        if (groups.length) return Promise.resolve();
        return Xtream.liveCategories().then(function (list) {
            var counts = {};
            groups = list.filter(function (c) {
                return Lang.showAdult() || !Lang.isAdult(c.category_name);
            }).map(function (c) {
                var m = /^\s*([^|]{1,12})\|\s*(.*)$/.exec(c.category_name);
                // Adult groups have no country prefix ("FOR ADULTS"): give them their own entry,
                // shown only after the PIN, instead of letting them fall into the hidden "Other".
                var code = Lang.isAdult(c.category_name) ? ADULT : m ? m[1].trim().toUpperCase() : 'OTHER';
                counts[code] = (counts[code] || 0) + 1;
                return { id: c.category_id, code: code, name: Xtream.clean(m ? m[2] : c.category_name) || c.category_name };
            });
            var pref = preferred();
            var codes = Object.keys(counts).filter(function (c) { return c === ADULT || Lang.keepCountry(c); });
            // None of the chosen countries exists at this provider: show every country rather than
            // an empty guide (the guide then had no country to open, 02.11.2026).
            if (!codes.some(function (c) { return c !== ADULT; })) codes = Object.keys(counts);
            codes = codes.sort(function (a, b) {
                if (a === ADULT || b === ADULT) return a === ADULT ? 1 : -1;
                var pa = pref.indexOf(a), pb = pref.indexOf(b);
                if (pa >= 0 || pb >= 0) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
                return counts[b] - counts[a];
            });
            countries = [{ code: FAV, name: 'Favourites' }].concat(codes.map(function (c) {
                return { code: c, name: COUNTRY_NAMES[c] || (c === 'OTHER' ? 'Other' : c === ADULT ? 'Adults' : c), count: counts[c] };
            }));
        });
    }

    function groupsOf(code) {
        if (code === FAV) return [{ id: FAV, code: FAV, name: 'All favourites' }];
        return groups.filter(function (g) { return g.code === code; });
    }

    function groupLabel(id) {
        if (id === FAV) return 'Favourites';
        var g = groups.filter(function (g) { return String(g.id) === String(id); })[0];
        return g ? g.name : '';
    }

    function channelsFor(groupId) {
        if (groupId === FAV) return Promise.resolve(Store.favourites());
        return Xtream.liveStreams(groupId);
    }

    // ---------- playback ----------

    function tune(delay) {
        clearTimeout(zapTimer);
        var ch = playing.channels[playing.idx];
        if (!ch) return;
        Store.set('lastLive', { group: playing.group, streamId: ch.stream_id, name: Xtream.clean(ch.name) });
        showOsd();
        spinEl.classList.add('show');
        // While the user is still pressing CH +/-, only update the banner; then resolve and play.
        zapTimer = setTimeout(function () {
            Log.info('tune ' + Xtream.clean(ch.name) + ' (' + ch.stream_id + ')');
            Xtream.liveUrl(ch).then(function (url) {
                if (playing.channels[playing.idx] !== ch) return; // user has already moved on
                tunedAt = Date.now();
                Player.play(url);
            }).catch(function (e) {
                if (playing.channels[playing.idx] !== ch) return;
                Log.error('no stream for ' + Xtream.clean(ch.name) + ': ' + e.message);
                spinEl.classList.remove('show');
                UI.toast('This channel is not available right now');
            });
        }, delay || 0);
    }

    function rememberPrevious() {
        if (playing.idx >= 0) previous = { group: playing.group, groupName: playing.groupName, channels: playing.channels, idx: playing.idx };
    }

    function zap(step) {
        var n = playing.channels.length;
        if (!n) return;
        rememberPrevious();
        failovers = 0; quickEnds = 0;
        playing.idx = (playing.idx + step + n) % n;
        tune(400);
    }

    function jumpTo(number) {
        if (number < 1 || number > playing.channels.length) { UI.toast('No channel ' + number + ' in ' + playing.groupName); return; }
        rememberPrevious();
        failovers = 0; quickEnds = 0;
        playing.idx = number - 1;
        tune(0);
    }

    function swapPrevious() {
        if (!previous) return;
        var cur = { group: playing.group, groupName: playing.groupName, channels: playing.channels, idx: playing.idx };
        playing = previous;
        previous = cur;
        failovers = 0; quickEnds = 0;
        tune(0);
    }

    // The player could not open the stream: try it on the next server, then give up.
    function onStreamError() {
        if (Xtream.nextStreamServer(failovers)) { failovers++; tune(1500); return; }
        failovers = 0; quickEnds = 0;
        spinEl.classList.remove('show');
        UI.toast('This channel is not available right now');
    }

    // ---------- info banner ----------

    function epgLine(e, label) {
        if (!e) return '';
        var span = e.end - e.start, pct = span > 0 ? Math.max(0, Math.min(100, (Date.now() - e.start) / span * 100)) : 0;
        return '<div class="epg"><span class="lbl">' + label + '</span><span class="time">' + UI.clock(new Date(e.start)) + '</span>' +
            '<span class="title">' + UI.esc(e.title) + '</span>' +
            (label === 'Now' ? '<span class="bar"><i style="width:' + pct + '%"></i></span>' : '') + '</div>';
    }

    function showOsd() {
        var ch = playing.channels[playing.idx];
        if (!ch) return;
        var fav = Store.isFavourite(ch.stream_id);
        osdEl.innerHTML = '<div class="num">' + (playing.idx + 1) + '</div>' +
            '<div class="info"><div class="name">' + UI.esc(Xtream.clean(ch.name)) + (fav ? '<span class="fav">Favourite</span>' : '') + '</div>' +
            '<div class="cat">' + UI.esc(playing.groupName) + '</div><div class="epgs"></div></div>' +
            '<div class="clock">' + UI.clock() + '</div>';
        osdEl.classList.add('show');
        var id = ch.stream_id;
        Xtream.shortEpg(id).then(function (list) {
            var cur = playing.channels[playing.idx];
            if (!cur || cur.stream_id !== id) return;
            var box = osdEl.querySelector('.epgs');
            if (box) box.innerHTML = epgLine(list[0], 'Now') + epgLine(list[1], 'Next');
        });
        clearTimeout(osdTimer);
        osdTimer = setTimeout(function () { osdEl.classList.remove('show'); }, 5000);
    }

    // ---------- guide ----------

    function chanRow(ch, i) {
        var live = playing.channels[playing.idx];
        var on = live && live.stream_id === ch.stream_id;
        return '<span class="n">' + (i + 1) + '</span>' +
            (ch.stream_icon ? '<span class="logo"><img src="' + UI.esc(ch.stream_icon) + '" onerror="this.parentNode.remove()"></span>' : '') +
            '<span class="name">' + UI.esc(Xtream.clean(ch.name)) + '</span>' +
            (Store.isFavourite(ch.stream_id) ? '<span class="star"></span>' : '') + (on ? '<span class="onair">On air</span>' : '');
    }

    function loadChannels(group, focusStreamId) {
        browse.group = group.id;
        browse.groupName = group.id === FAV ? 'Favourites' : group.name;
        browse.channels = [];
        chanList.set([]);
        chanList.el.innerHTML = '<div class="empty">Loading...</div>';
        return channelsFor(group.id).then(function (list) {
            if (browse.group !== group.id) return;
            browse.channels = list;
            var idx = 0;
            list.forEach(function (s, i) { if (s.stream_id === focusStreamId) idx = i; });
            chanList.set(list, idx);
            if (!list.length) {
                chanList.el.innerHTML = '<div class="empty">' + (group.id === FAV ? 'Hold OK on a channel to add it here.' : 'No channels') + '</div>';
            }
            updatePreview();
        }).catch(function (e) { chanList.el.innerHTML = '<div class="empty">Could not load: ' + UI.esc(e.message) + '</div>'; });
    }

    function showGroups(code, focusGroupId) {
        var list = groupsOf(code);
        var idx = 0;
        list.forEach(function (g, i) { if (String(g.id) === String(focusGroupId)) idx = i; });
        groupList.set(list, idx);
        return list[idx];
    }

    function updatePreview() {
        clearTimeout(previewTimer);
        var ch = chanList.current();
        if (!ch) { previewEl.innerHTML = ''; return; }
        previewEl.innerHTML = '<div class="pname">' + UI.esc(Xtream.clean(ch.name)) + '</div><div class="epgs"></div>';
        previewTimer = setTimeout(function () {
            Xtream.shortEpg(ch.stream_id).then(function (list) {
                if (chanList.current() !== ch) return;
                var box = previewEl.querySelector('.epgs');
                if (box) box.innerHTML = list.length ? epgLine(list[0], 'Now') + epgLine(list[1], 'Next') : '';
            });
        }, 350);
    }

    function setGuideCol(col) {
        guideCol = col;
        countryList.setActive(col === 'countries');
        groupList.setActive(col === 'groups');
        chanList.setActive(col === 'chans');
    }

    function openGuide() {
        guideOpen = true;
        guideEl.classList.add('show');
        osdEl.classList.remove('show');
        var groupId = playing.group;
        var code;
        if (groupId === FAV || groupId == null) {
            code = groupId === FAV || Store.favourites().length ? FAV : (countries[1] && countries[1].code);
        } else {
            var g = groups.filter(function (g) { return String(g.id) === String(groupId); })[0];
            code = g ? g.code : (countries[1] || countries[0]).code;
        }
        var ci = 0;
        countries.forEach(function (c, i) { if (c.code === code) ci = i; });
        countryList.set(countries, ci);
        var group = showGroups(code, groupId);
        var ch = playing.channels[playing.idx];
        if (group) loadChannels(group, ch && ch.stream_id);
        setGuideCol(groupId == null ? 'countries' : 'chans');
    }

    function closeGuide() {
        guideOpen = false;
        guideEl.classList.remove('show');
    }

    function moveIn(list, delta) {
        if (!list.move(delta)) return;
        clearTimeout(colTimer);
        if (list === countryList) {
            colTimer = setTimeout(function () {
                var g = showGroups(countryList.current().code);
                if (g) loadChannels(g);
            }, 300);
        } else if (list === groupList) {
            colTimer = setTimeout(function () { loadChannels(groupList.current()); }, 300);
        } else {
            updatePreview();
        }
    }

    function guideKey(a) {
        var list = guideCol === 'countries' ? countryList : guideCol === 'groups' ? groupList : chanList;
        var page = list.visibleRows() - 1;
        switch (a.type) {
            case 'up': moveIn(list, -UI.holdStep(a.pressMs, page)); return true;
            case 'down': moveIn(list, UI.holdStep(a.pressMs, page)); return true;
            case 'chUp': moveIn(list, -page); return true;
            case 'chDown': moveIn(list, page); return true;
            case 'left':
                if (guideCol === 'chans') setGuideCol('groups');
                else if (guideCol === 'groups') setGuideCol('countries');
                return true;
            case 'right':
                if (guideCol === 'countries') setGuideCol('groups');
                else if (guideCol === 'groups' && browse.channels.length) setGuideCol('chans');
                return true;
            case 'ok':
                if (guideCol === 'countries') { setGuideCol('groups'); return true; }
                if (guideCol === 'groups') { if (browse.channels.length) setGuideCol('chans'); return true; }
                if (!chanList.current()) return true;
                rememberPrevious();
                failovers = 0; quickEnds = 0;
                playing = { group: browse.group, groupName: browse.groupName, channels: browse.channels, idx: chanList.index };
                closeGuide();
                tune(0);
                return true;
            case 'yellow': case 'okLong':
                if (guideCol !== 'chans' || !chanList.current()) return true;
                UI.toast(Store.toggleFavourite(chanList.current()) ? 'Added to Favourites' : 'Removed from Favourites');
                if (browse.group === FAV) loadChannels(groupList.current()); else { chanList.first = -1; chanList.render(); }
                return true;
            case 'back':
                if (guideCol === 'chans') { setGuideCol('groups'); return true; }
                if (guideCol === 'groups') { setGuideCol('countries'); return true; }
                if (playing.idx >= 0) closeGuide(); else App.back();
                return true;
            case 'list':
                if (playing.idx >= 0) closeGuide(); else App.back();
                return true;
            default: return true;
        }
    }

    // ---------- number entry ----------

    function digit(n) {
        numBuf = (numBuf + n).slice(-4);
        numEl.textContent = numBuf;
        numEl.classList.add('show');
        clearTimeout(numTimer);
        numTimer = setTimeout(function () {
            numEl.classList.remove('show');
            var v = parseInt(numBuf, 10);
            numBuf = '';
            jumpTo(v);
        }, 1500);
    }

    // ---------- screen ----------

    function start(params) {
        el.querySelector('.spinner').classList.add('show');
        loadGroups().then(function () {
            spinEl.classList.remove('show');
            if (params.play) {
                var want = params.play;
                return channelsFor(want.category_id).then(function (list) {
                    var idx = 0;
                    list.forEach(function (s, i) { if (s.stream_id === want.stream_id) idx = i; });
                    if (!list.length) list = [want];
                    rememberPrevious();
                    playing = { group: want.category_id, groupName: groupLabel(want.category_id), channels: list, idx: idx };
                    tune(0);
                });
            }
            if (playing.idx >= 0) { tune(0); return; }
            var last = Store.get('lastLive', null);
            if (!last || last.group == null) { openGuide(); return; }
            return channelsFor(last.group).then(function (list) {
                var idx = -1;
                list.forEach(function (s, i) { if (s.stream_id === last.streamId) idx = i; });
                if (idx < 0) { openGuide(); return; }
                playing = { group: last.group, groupName: groupLabel(last.group), channels: list, idx: idx };
                tune(0);
            });
        }).catch(function (e) {
            spinEl.classList.remove('show');
            Log.error('live start failed: ' + e.message);
            UI.toast('IPTV service not reachable: ' + e.message);
        });
    }

    window.Views.live = {
        mount: function (root, params, restoring) {
            el = document.createElement('div');
            el.className = 'live';
            el.innerHTML = '<div class="spinner"></div><div class="numbuf"></div><div class="osd"></div>' +
                '<div class="guide"><div class="col countries"></div><div class="col groups"></div><div class="col chans"></div><div class="preview"></div>' +
                '<div class="hints"><kbd>CH</kbd> page <kbd>Hold OK</kbd> favourite <kbd>Back</kbd> close</div></div>';
            root.appendChild(el);
            osdEl = el.querySelector('.osd');
            guideEl = el.querySelector('.guide');
            numEl = el.querySelector('.numbuf');
            spinEl = el.querySelector('.spinner');
            previewEl = el.querySelector('.preview');
            var nameRow = function (x) { return '<span class="name">' + UI.esc(x.name) + '</span>'; };
            countryList = new UI.VList(el.querySelector('.countries'), { rowH: 60, renderRow: nameRow });
            groupList = new UI.VList(el.querySelector('.groups'), { rowH: 60, renderRow: nameRow });
            chanList = new UI.VList(el.querySelector('.chans'), { rowH: 72, renderRow: chanRow });
            guideOpen = false;

            Player.on({
                buffering: function (on) { spinEl.classList.toggle('show', on); },
                ready: function () { failovers = 0; },
                error: onStreamError,
                // Live streams that drop: reconnect. A stream that "ends" seconds after starting is a
                // placeholder (blocked server) or a dead channel: treat it as an error instead of
                // reconnecting in a loop (that loop got the account throttled, 31.10.2026).
                ended: function () {
                    // Sample channels are recorded films: start them again.
                    if (Xtream.isDemo()) { tune(0); return; }
                    if (Date.now() - tunedAt < 15000) {
                        if (++quickEnds >= 2) { quickEnds = 0; Log.info('stream keeps ending at once'); onStreamError(); return; }
                    } else quickEnds = 0;
                    tune(0);
                }
            });
            start(restoring ? {} : params);
        },
        // Settings changed what is shown: rebuild the country list next time.
        reset: function () { countries = []; groups = []; },
        unmount: function () {
            clearTimeout(osdTimer); clearTimeout(zapTimer); clearTimeout(numTimer);
            clearTimeout(colTimer); clearTimeout(previewTimer);
            Player.stop();
            Player.on(null);
        },
        longOk: true,
        onShow: function () { if (playing.idx >= 0) tune(0); },
        onKey: function (a) {
            if (guideOpen) return guideKey(a);
            switch (a.type) {
                case 'chUp': case 'up': zap(1); return true;
                case 'chDown': case 'down': zap(-1); return true;
                case 'digit': digit(a.n); return true;
                case 'prevCh': swapPrevious(); return true;
                case 'ok': case 'list': case 'left': case 'right': openGuide(); return true;
                case 'info': if (osdEl.classList.contains('show')) osdEl.classList.remove('show'); else showOsd(); return true;
                case 'yellow': case 'okLong':
                    var ch = playing.channels[playing.idx];
                    if (ch) { UI.toast(Store.toggleFavourite(ch) ? 'Added to Favourites' : 'Removed from Favourites'); showOsd(); }
                    return true;
                case 'back': App.back(); return true;
                default: return true;
            }
        }
    };
})();
