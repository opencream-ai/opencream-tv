/* Home: a photograph, the time, and one glass dock with everything we use. */
(function () {
    'use strict';

    window.Views = window.Views || {};

    // -1 = a different one each day; 0..5 = a fixed choice.
    var WALLPAPERS = [
        { src: 'img/wall/w1.jpg', name: 'Sea cliffs' },
        { src: 'img/wall/w2.jpg', name: 'Fjord' },
        { src: 'img/wall/w3.jpg', name: 'Green highland' },
        { src: 'img/wall/w4.jpg', name: 'River valley' },
        { src: 'img/wall/w5.jpg', name: 'Pine forest' },
        { src: 'img/wall/w6.jpg', name: 'Dark coast' }
    ];

    // Live TV, Movies, Series, then the apps chosen in Settings (Apps.dock()), then the consoles.
    var DOCK = [];

    function buildDock() {
        DOCK = [
            { kind: 'live', label: 'Live TV', icon: 'live' },
            { kind: 'movies', label: 'Movies', icon: 'movies' },
            { kind: 'series', label: 'Series', icon: 'series' }
        ].concat(Apps.dock().map(function (a) {
            return { kind: 'app', label: a.label, icon: a.icon, iconPath: a.iconPath, id: a.id };
        })).concat(Inputs.list().map(function (p) {
            return { kind: 'hdmi', label: p.name, icon: p.icon || 'hdmi', port: p.port };
        }));
        if (focus.zone === 'dock' && focus.i >= DOCK.length) focus.i = DOCK.length - 1;
    }

    var TOP = [
        { kind: 'search', icon: 'search', hint: 'Search channels, programmes, movies and series' },
        { kind: 'wallpaper', icon: 'image', hint: 'Change photograph' },
        { kind: 'samsung', icon: 'home', hint: 'Samsung Smart Hub' },
        { kind: 'settings', icon: 'settings', hint: 'Settings' }
    ];

    var focus = { zone: 'dock', i: 0 };
    var el, clockTimer, hdmi = {};
    // Recently watched overlay (opened with Back on the home screen): null when closed.
    var recents = null;

    function wallpaper() {
        var chosen = Store.get('wallpaper', -1);
        var i = chosen < 0 ? Math.floor(Date.now() / 864e5) % WALLPAPERS.length : chosen % WALLPAPERS.length;
        return WALLPAPERS[i].src;
    }

    function nextWallpaper() {
        if (Store.get('bgStyle', 'photo') === 'dark') { UI.toast('Background is set to Dark in Settings'); return; }
        var chosen = Store.get('wallpaper', -1);
        // Cycle: Daily (-1) -> 0 -> 1 ... -> 5 -> Daily
        Store.set('wallpaper', chosen < 0 ? 0 : (chosen + 1 >= WALLPAPERS.length ? -1 : chosen + 1));
        var ph = el.querySelector('.photo');
        if (ph) ph.style.backgroundImage = 'url(' + wallpaper() + ')';
        var c = Store.get('wallpaper', -1);
        UI.toast(c < 0 ? 'A different photo each day' : WALLPAPERS[c].name);
    }

    function hdmiOff(item) {
        var p = item.port;
        return !p || hdmi[p] === false;
    }

    function iconsOnly() { return Store.get('dockLabels', 'shown') === 'hidden'; }

    // One quiet line above the dock about the focused item. Without names under the icons,
    // it starts with the item's name so it is clear what is selected.
    function caption() {
        if (focus.zone !== 'dock') return TOP[focus.i].hint;
        var item = DOCK[focus.i], extra = detail(item);
        if (!iconsOnly()) return extra;
        return item.label + (extra ? ': ' + extra : '');
    }

    function detail(item) {
        if (item.kind === 'live') {
            var last = Store.get('lastLive', null);
            return last ? 'Continue with ' + last.name : 'Your live channels';
        }
        if (item.kind === 'hdmi') {
            var p = item.port;
            if (!p) return 'Choose its HDMI port in Settings';
            return hdmi[p] === false ? 'HDMI ' + p + ', nothing connected' : 'HDMI ' + p;
        }
        return '';
    }

    function weatherHtml() {
        var w = Weather.enabled() && Weather.current();
        if (!w || !Icons[w.icon]) return '';
        return '<span class="wicon">' + Icons[w.icon] + '</span><span class="wtemp">' + w.temp + '°</span>';
    }

    function paintWeather() {
        var n = el && el.querySelector('.weather');
        if (n) n.innerHTML = weatherHtml();
    }

    // Recently watched: the last live channel, then films and episodes with a resume point.
    function recentItems() {
        var out = [];
        var last = Store.get('lastLive', null);
        if (last && last.streamId != null) {
            out.push({ kind: 'live', title: last.name || 'Live TV', sub: 'Continue watching live',
                play: { stream_id: last.streamId, category_id: last.group } });
        }
        Store.resumeList().forEach(function (r) {
            if (r && r.params && r.title) {
                out.push({ kind: 'vod', title: r.title, sub: r.sub || ('Resume from ' + UI.duration(r.pos)), params: r.params });
            }
        });
        return out.slice(0, 10);
    }

    function openRecent(it) {
        if (!it) return;
        recents = null;
        if (needsIptv()) return; // sends the user to Settings to connect first
        if (it.kind === 'live') App.go('live', { play: it.play });
        else App.go('player', it.params);
    }

    function renderRecents() {
        var items = recents.items;
        var rows = items.length
            ? '<div class="rlist">' + items.map(function (it, i) {
                var ic = it.kind === 'live' ? 'live' : 'movies';
                return '<div class="rrow' + (i === recents.i ? ' focus' : '') + '">' +
                    '<span class="ricon">' + Icons[ic] + '</span><span class="rtext">' +
                    '<span class="rtitle">' + UI.esc(it.title) + '</span>' +
                    (it.sub ? '<span class="rsub">' + UI.esc(it.sub) + '</span>' : '') + '</span></div>';
            }).join('') + '</div>'
            : '<p class="hint">Nothing yet. The films, episodes and live channel you watch show up here.</p>';
        el.innerHTML = '<div class="recents"><header class="set-head"><h1>Recently watched</h1></header>' +
            '<div class="set-body">' + rows + '<p class="hint">' +
            (items.length ? 'OK resumes. ' : '') + 'Back closes.</p></div></div>';
    }

    function startClock() {
        stopClock();
        clockTimer = setInterval(function () {
            var c = el.querySelector('.clock');
            if (c) c.textContent = UI.clock();
            paintWeather(); // also starts a weather refresh when one is due (every 30 min)
        }, 15000);
    }
    function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }

    function render() {
        if (recents) { renderRecents(); return; }
        buildDock();
        // Background style: "photo" shows a landscape; "dark" is a plain dark field (lower backlight).
        var dark = Store.get('bgStyle', 'photo') === 'dark';
        el.classList.toggle('dark-bg', dark);
        el.classList.toggle('compact', iconsOnly());
        var dockCls = 'dock glass' + (iconsOnly() ? ' icons-only' : '') + (Store.get('dockAlign', 'wide') === 'left' ? ' left' : '');
        var html = (dark ? '' : '<div class="photo" style="background-image:url(' + wallpaper() + ')"></div><div class="shade"></div>') +
            '<div class="clockrow"><span class="clock">' + UI.clock() + '</span><span class="weather">' + weatherHtml() + '</span></div>' +
            '<div class="topbar">' + TOP.map(function (t, i) {
                return '<div class="tbtn glass" data-z="top" data-i="' + i + '">' + Icons[t.icon] + '</div>';
            }).join('') + '</div>' +
            '<div class="caption"></div>' +
            '<div class="' + dockCls + '">' + DOCK.map(function (d, i) {
                return '<div class="ditem' + (d.kind === 'hdmi' && hdmiOff(d) ? ' dim' : '') + '" data-z="dock" data-i="' + i + '">' +
                    '<div class="dicon i-' + (d.icon || 'tvapp') + '">' + (d.kind === 'app' ? Apps.iconHtml(d) : Icons[d.icon]) + '</div><div class="dlabel">' + d.label + '</div></div>';
            }).join('') + '</div>';
        el.innerHTML = html;
        paintFocus();
    }

    function paintFocus() {
        Array.prototype.forEach.call(el.querySelectorAll('[data-z]'), function (n) {
            n.classList.toggle('focus', n.getAttribute('data-z') === focus.zone && +n.getAttribute('data-i') === focus.i);
        });
        el.querySelector('.caption').textContent = caption();
    }

    function needsIptv() {
        if (Xtream.configured()) return false;
        UI.toast('Connect your IPTV service first');
        App.go('settings');
        return true;
    }

    function open(item) {
        switch (item.kind) {
            case 'live': if (!needsIptv()) App.go('live'); break;
            case 'movies': if (!needsIptv()) App.go('library', { kind: 'movies' }); break;
            case 'series': if (!needsIptv()) App.go('library', { kind: 'series' }); break;
            case 'app':
                Platform.launchApp(item.id).catch(function () {
                    UI.toast(item.label + ' could not be opened. Is it still installed? Settings → Apps in the dock');
                });
                break;
            case 'hdmi':
                var p = item.port;
                if (!p) { App.go('settings'); break; }
                Platform.openHdmi(p).catch(function (e) {
                    Log.error('hdmi ' + p + ': ' + e.message);
                    UI.toast('Could not switch to HDMI ' + p);
                });
                break;
            case 'search': if (!needsIptv()) App.go('search'); break;
            case 'wallpaper': nextWallpaper(); break;
            case 'samsung': Platform.openSamsungHome().catch(function () { UI.toast('Could not open Samsung Home'); }); break;
            case 'settings': App.go('settings'); break;
        }
    }

    function refreshHdmi() {
        Platform.hdmiStatus().then(function (s) { hdmi = s; render(); }).catch(function () { /* keep tiles as they are */ });
    }

    window.Views.home = {
        wallpapers: WALLPAPERS,
        mount: function (root) {
            el = document.createElement('div');
            el.className = 'home';
            root.appendChild(el);
            render();
            refreshHdmi();
            // Keep the search index fresh in the background.
            setTimeout(function () { Search.refresh(); }, 20000);
            Weather.onChange(paintWeather);
            startClock();
        },
        unmount: function () { stopClock(); Weather.onChange(function () {}); },
        // While another app is in front, stop the clock and weather timer (main.js also stops the
        // player). Coming back shows the home screen, not any overlay that was open.
        onHide: function () { stopClock(); },
        onShow: function () { recents = null; render(); refreshHdmi(); startClock(); },
        onKey: function (a) {
            if (recents) {
                switch (a.type) {
                    case 'up': if (recents.i > 0) { recents.i--; renderRecents(); } return true;
                    case 'down': if (recents.i < recents.items.length - 1) { recents.i++; renderRecents(); } return true;
                    case 'ok': openRecent(recents.items[recents.i]); return true;
                    case 'back': recents = null; render(); return true;
                    default: return true;
                }
            }
            var n = focus.zone === 'dock' ? DOCK.length : TOP.length;
            switch (a.type) {
                case 'left': if (focus.i > 0) focus.i--; break;
                case 'right': if (focus.i < n - 1) focus.i++; break;
                case 'up': if (focus.zone === 'dock') focus = { zone: 'top', i: TOP.length - 1 }; break;
                case 'down': if (focus.zone === 'top') focus = { zone: 'dock', i: 0 }; break;
                case 'ok': open(focus.zone === 'dock' ? DOCK[focus.i] : TOP[focus.i]); return true;
                case 'chUp': case 'chDown': case 'list':
                    if (!needsIptv()) App.go('live');
                    return true;
                case 'back': recents = { items: recentItems(), i: 0 }; render(); return true; // Home is the bottom of the stack; Back shows recently watched.
                default: return false;
            }
            paintFocus();
            return true;
        }
    };
})();
