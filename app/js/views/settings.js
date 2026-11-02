/* Settings: IPTV login (Xtream Codes) and which HDMI port each console uses. */
(function () {
    'use strict';

    window.Views = window.Views || {};

    var el, rows, idx = 0, hdmi = {};
    // "Add an app" list: null when closed, else { items, idx, fallback }.
    var picker = null;
    // About page open or not. QR codes are SVG files made by tools/make-qr.py; a link appears only
    // once its page exists (set the file name here when the donation page / public repo are live).
    var about = false;
    // Multi-choice list (Live TV countries, film/series languages): null when closed.
    var multi = null;
    var ABOUT_LINKS = [
        { qr: 'img/qr/opencream.svg', title: 'Made by opencream.ai', sub: 'Scan to visit opencream.ai' }
        // { qr: 'img/qr/donate.svg', title: 'Buy me a coffee', sub: 'opencream TV is free. Support it here' },
        // { qr: 'img/qr/source.svg', title: 'Source code', sub: 'GPL-3.0 on GitHub' }
    ];

    function fieldRow(key, label, type) {
        return { kind: 'field', key: key, label: label, type: type };
    }

    function build() {
        rows = [
            fieldRow('server', 'Servers', 'text'),
            fieldRow('user', 'Username', 'text'),
            fieldRow('pass', 'Password', 'password'),
            { kind: 'button', key: 'connect', label: 'Connect' },
            { kind: 'button', key: 'next', label: 'Switch to next server' }
        ].concat(Apps.dock().map(function (a, i) {
            return { kind: 'dockapp', key: 'dock' + i, i: i, app: a };
        })).concat([
            { kind: 'button', key: 'addApp', label: 'Add an app' }
        ]).concat(Inputs.list().map(function (p, i) {
            return { kind: 'inputrow', key: 'input' + i, i: i, input: p };
        })).concat([
            { kind: 'button', key: 'addInput', label: 'Add an HDMI input' },
            { kind: 'button', key: 'pickCountries', label: 'Live TV countries' },
            { kind: 'button', key: 'pickLangs', label: 'Film and series languages' },
            { kind: 'toggle', key: 'allLanguages', label: 'Other languages and countries', on: 'Shown', off: 'Hidden' },
            { kind: 'toggle', key: 'showAdult', label: 'Adult groups', on: 'Shown', off: 'Hidden' },
            { kind: 'choice', key: 'bgStyle', label: 'Background', opts: [['photo', 'Photo'], ['dark', 'Dark (cooler)']], def: 'photo' },
            { kind: 'choice', key: 'wallpaper', label: 'Wallpaper', wallpaper: true },
            // Appearance options are choices, not toggles: toggle() rebuilds the search index.
            { kind: 'choice', key: 'dockLabels', label: 'Names under icons', opts: [['shown', 'Shown'], ['hidden', 'Hidden']], def: 'shown' },
            { kind: 'choice', key: 'dockAlign', label: 'Icon row', opts: [['wide', 'Full width'], ['left', 'Left']], def: 'wide' },
            { kind: 'choice', key: 'clock12', label: 'Clock', opts: [[false, '24-hour'], [true, '12-hour']], def: false },
            { kind: 'choice', key: 'weather', label: 'Weather', opts: [[true, 'Shown'], [false, 'Hidden']], def: true, weather: true },
            { kind: 'field', key: 'town', label: 'Weather town', type: 'text' },
            { kind: 'button', key: 'townAuto', label: 'Find my town from the internet address' },
            { kind: 'button', key: 'demo', label: 'Try with sample channels' },
            { kind: 'button', key: 'about', label: 'About opencream TV' }
        ]);
    }

    function appLabel(a) {
        return '<span class="lbl app"><span class="sicon i-' + (a.icon || 'tvapp') + '">' + Apps.iconHtml(a) + '</span>' + UI.esc(a.label) + '</span>';
    }

    function renderPicker() {
        var html = '<header class="set-head"><h1>Add an app</h1></header><div class="set-body">' +
            '<p class="hint">' + (picker.fallback
                ? 'This TV did not list its apps. These are services the app knows; pick one you have installed.'
                : 'Apps installed on this TV that are not on the dock yet. Back returns to Settings.') + '</p>';
        if (!picker.items.length) html += '<p class="status">Every app found on this TV is already on the dock.</p>';
        picker.items.forEach(function (a, i) {
            html += '<div class="srow' + (i === picker.idx ? ' focus' : '') + '">' + appLabel(a) + '</div>';
        });
        el.innerHTML = html + '</div>';
        keepVisible();
    }

    function openPicker() {
        UI.toast('Looking for apps on this TV...');
        Apps.installed().then(function (list) {
            var fallback = !list.length;
            var items = (fallback ? Apps.knownList() : list).filter(function (a) { return !Apps.inDock(a.id); });
            picker = { items: items, idx: 0, fallback: fallback };
            renderPicker();
        });
    }

    function pickerKey(a) {
        switch (a.type) {
            case 'up': if (picker.idx > 0) picker.idx--; break;
            case 'down': if (picker.idx < picker.items.length - 1) picker.idx++; break;
            case 'ok':
                var app = picker.items[picker.idx];
                if (app) { Apps.add(app); UI.toast(app.label + ' added to the dock'); }
                closePicker('addApp');
                return true;
            case 'back': closePicker('addApp'); return true;
            default: return true;
        }
        renderPicker();
        return true;
    }

    function closePicker(focusKey) {
        picker = null;
        build();
        for (var i = 0; i < rows.length; i++) if (rows[i].key === focusKey) idx = i;
        render();
    }

    function version() {
        try { return tizen.application.getCurrentApplication().appInfo.version; } catch (e) { return ''; }
    }

    function renderAbout() {
        var v = version();
        el.innerHTML = '<header class="set-head"><h1>About</h1></header><div class="set-body about">' +
            '<p class="about-lead">opencream TV' + (v ? ' · version ' + UI.esc(v) : '') + '</p>' +
            '<p class="hint">A calm home screen for Samsung TVs with your own IPTV service built in. It includes no channels: ' +
            'it plays the service you subscribe to. Free software under the GNU General Public License, version 3.</p>' +
            '<p class="hint">Privacy: your IPTV login stays on this TV. For the weather, Open-Meteo receives the town you typed and sends the forecast; like any website it sees the TV\'s internet address. ip-api.com is used only if you choose to find your town from the internet address. Nothing else is collected.</p>' +
            '<div class="qrs">' + ABOUT_LINKS.map(function (l) {
                return '<div class="qr"><img src="' + l.qr + '" alt=""><div><p class="qr-title">' + UI.esc(l.title) +
                    '</p><p class="hint">' + UI.esc(l.sub) + '</p></div></div>';
            }).join('') + '</div><p class="hint">Back returns to Settings.</p></div>';
    }

    function renderMulti() {
        var html = '<header class="set-head"><h1>' + multi.title + '</h1></header><div class="set-body"><p class="hint">' + multi.hint + '</p>';
        if (!multi.items.length) html += '<p class="status">Your IPTV service did not list any.</p>';
        multi.items.forEach(function (it, i) {
            html += '<div class="srow' + (i === multi.idx ? ' focus' : '') + '"><span class="lbl">' + UI.esc(it.name) +
                ' <span class="note">' + it.count + '</span></span><span class="val">' + (multi.sel[it.code] ? 'Shown' : '') + '</span></div>';
        });
        el.innerHTML = html + '</div>';
        keepVisible();
    }

    function countLive() {
        return Xtream.liveCategories().then(function (cats) {
            var n = {};
            cats.forEach(function (c) {
                if (Lang.isAdult(c.category_name)) return;
                var m = /^\s*([^|]{1,12})\|/.exec(c.category_name);
                var code = m ? m[1].trim().toUpperCase() : 'OTHER';
                if (code !== 'OTHER') n[code] = (n[code] || 0) + 1;
            });
            return Object.keys(n).map(function (c) { return { code: c, name: Lang.COUNTRY_NAMES[c] || c, count: n[c] + ' groups' }; })
                .sort(function (a, b) { return parseInt(b.count, 10) - parseInt(a.count, 10); });
        });
    }

    function countLangs() {
        return Promise.all([Xtream.vodCategories(), Xtream.seriesCategories()]).then(function (r) {
            var n = {};
            r[0].concat(r[1]).forEach(function (c) {
                if (Lang.isAdult(c.category_name)) return;
                var l = Lang.langOf(c.category_name);
                if (l !== 'other' && l !== 'any') n[l] = (n[l] || 0) + 1;
            });
            return Object.keys(n).map(function (l) { return { code: l, name: Lang.LANG_NAMES[l] || l.toUpperCase(), count: n[l] + ' groups' }; })
                .sort(function (a, b) { return parseInt(b.count, 10) - parseInt(a.count, 10); });
        });
    }

    function openMulti(kind) {
        if (!Xtream.configured() || Xtream.server() === 'demo') { UI.toast('Connect your IPTV service first'); return; }
        UI.toast('Asking your IPTV service...');
        var live = kind === 'countries';
        var current = live ? Lang.countries() : Lang.langs();
        (live ? countLive() : countLangs()).then(function (items) {
            var sel = {};
            current.forEach(function (c) { sel[c] = true; });
            multi = {
                kind: kind, items: items, sel: sel, idx: 0, before: current.slice(),
                title: live ? 'Live TV countries' : 'Film and series languages',
                hint: (live ? 'Countries in your IPTV service, by number of channel groups.'
                    : 'Languages of the film and series groups in your IPTV service.') + ' OK shows or hides one. Back saves.'
            };
            render();
        }).catch(function (e) { UI.toast('Could not load the list: ' + e.message); });
    }

    function closeMulti() {
        var live = multi.kind === 'countries';
        // Keep the old order for what stays, add new picks at the end (order = guide order).
        var picked = multi.before.filter(function (c) { return multi.sel[c]; });
        multi.items.forEach(function (it) { if (multi.sel[it.code] && picked.indexOf(it.code) < 0) picked.push(it.code); });
        var changed = picked.join() !== multi.before.join();
        if (!picked.length) { UI.toast('Pick at least one'); return; }
        multi = null;
        if (changed) {
            if (live) Lang.setCountries(picked); else Lang.setLangs(picked);
            // Rebuild only the affected list, slowly in the background (never the whole index).
            Search.drop(live ? ['live'] : ['movie', 'series']);
            Views.live.reset();
            Views.library.reset();
            UI.toast(live ? 'Saved. Channel search updates in a minute.' : 'Saved. Film and series search updates in a few minutes.');
            setTimeout(function () { Search.refresh(); }, 3000);
        }
        render();
    }

    function multiKey(a) {
        switch (a.type) {
            case 'up': if (multi.idx > 0) multi.idx--; break;
            case 'down': if (multi.idx < multi.items.length - 1) multi.idx++; break;
            case 'ok': var it = multi.items[multi.idx]; if (it) multi.sel[it.code] = !multi.sel[it.code]; break;
            case 'back': closeMulti(); return true;
            default: return true;
        }
        renderMulti();
        return true;
    }

    function render() {
        if (multi) { renderMulti(); return; }
        if (picker) { renderPicker(); return; }
        if (about) { renderAbout(); return; }
        var c = Xtream.creds() || {};
        var html = '<header class="set-head"><h1>Settings</h1></header><div class="set-body">' +
            '<h2>IPTV service</h2><p class="hint">The Xtream Codes login from your IPTV provider. Several server addresses can be listed, separated by commas; the app moves to the next one when a server stops answering.</p>';
        rows.forEach(function (r, i) {
            if (r.key === 'dock0' || (r.key === 'addApp' && !Apps.dock().length)) html += '<h2>Apps in the dock</h2><p class="hint">Left and right move an app along the dock. OK removes it.</p>';
            if (r.key === 'input0' || (r.key === 'addInput' && !Inputs.list().length)) html += '<h2>Consoles and inputs</h2><p class="hint">HDMI devices on the dock. Left and right name the input; OK removes it.</p>';
            if (r.key === 'pickCountries') html += '<h2>What to show</h2><p class="hint">Only the countries and languages you pick are listed and searched. "Other languages and countries" shows everything your provider offers.</p>';
            if (r.key === 'bgStyle') html += '<h2>Appearance</h2>';
            if (r.key === 'demo') html += '<h2>Other</h2>';
            var cls = 'srow' + (i === idx ? ' focus' : '');
            if (r.kind === 'field') {
                var v = r.key === 'town' ? Weather.place() : r.key === 'server' ? (c.servers || []).filter(function (x) { return x !== 'demo'; }).join(', ') : (c.servers && c.servers[0] === 'demo' ? '' : c[r.key] || '');
                html += '<label class="' + cls + '"><span class="lbl">' + r.label + '</span>' +
                    '<input data-key="' + r.key + '" type="' + r.type + '" value="' + UI.esc(v) + '" autocomplete="off" spellcheck="false"></label>';
            } else if (r.kind === 'toggle') {
                var on = r.key === 'showAdult' ? Lang.showAdult() : Store.get(r.key, false);
                html += '<div class="' + cls + '"><span class="lbl">' + r.label + '</span><span class="val">' + (on ? r.on : r.off) + '</span></div>';
            } else if (r.kind === 'choice') {
                var lbl = r.label + (r.weather && Weather.place() ? ' <span class="note">' + UI.esc(Weather.place()) + '</span>' : '');
                html += '<div class="' + cls + '"><span class="lbl">' + lbl + '</span><span class="val">' +
                    '<span class="arrow">&lsaquo;</span>' + UI.esc(choiceLabel(r)) + '<span class="arrow">&rsaquo;</span></span></div>';
            } else if (r.key === 'pickCountries' || r.key === 'pickLangs') {
                var names = r.key === 'pickCountries'
                    ? Lang.countries().map(function (c) { return Lang.COUNTRY_NAMES[c] || c; })
                    : Lang.langs().map(function (l) { return Lang.LANG_NAMES[l] || l; });
                var sum = names.slice(0, 3).join(', ') + (names.length > 3 ? ' +' + (names.length - 3) : '');
                html += '<div class="' + cls + '"><span class="lbl">' + r.label + '</span><span class="val">' + UI.esc(sum) + '</span></div>';
            } else if (r.kind === 'dockapp') {
                html += '<div class="' + cls + '">' + appLabel(r.app) + '<span class="val">' +
                    '<span class="arrow">&lsaquo;</span>Move<span class="arrow">&rsaquo;</span></span></div>';
            } else if (r.kind === 'inputrow') {
                var p = r.input, pIcon = Icons[p.icon] || Icons.hdmi;
                var note = 'HDMI ' + p.port + (hdmi[p.port] === false ? ' · nothing connected' : hdmi[p.port] === true ? ' · connected' : '');
                html += '<div class="' + cls + '"><span class="lbl app"><span class="sicon i-' + (p.icon || 'hdmi') + '">' + pIcon + '</span>' +
                    UI.esc(p.name) + ' <span class="note">' + note + '</span></span><span class="val">' +
                    '<span class="arrow">&lsaquo;</span>Name<span class="arrow">&rsaquo;</span></span></div>';
            } else {
                html += '<div class="' + cls + ' sbtn"><span>' + r.label + '</span></div>';
            }
        });
        if (c.servers) html += '<p class="status">Using ' + UI.esc(Xtream.server() === 'demo' ? 'sample channels' : Xtream.server()) +
            (c.servers.length > 1 ? ' · server ' + ((c.active || 0) + 1) + ' of ' + c.servers.length : '') + '</p>';
        el.innerHTML = html + '</div>';
        // The town is looked up when the on-screen keyboard closes (the field's change event).
        var town = el.querySelector('input[data-key="town"]');
        if (town) town.addEventListener('change', function () {
            UI.toast('Looking up ' + town.value + '...');
            Weather.setTown(town.value).then(function (p) {
                UI.toast('Weather for ' + p.city + (p.country ? ', ' + p.country : ''));
                render();
            }).catch(function (e) { UI.toast(e.message === 'town not found' ? 'Town not found' : 'Could not look up the town'); });
        });
        keepVisible();
    }

    // The page is taller than the screen: scroll so the focused row stays in view (31.10.2026,
    // Clock and the rows below were cut off and could be focused without being seen).
    function keepVisible() {
        var f = el.querySelector('.srow.focus');
        if (!f) return;
        var top = f.offsetTop, bottom = top + f.offsetHeight, margin = 160;
        if (idx === 0) el.scrollTop = 0;
        else if (bottom + margin > el.scrollTop + el.clientHeight) el.scrollTop = bottom + margin - el.clientHeight;
        else if (top - margin < el.scrollTop) el.scrollTop = Math.max(0, top - margin);
    }

    function value(key) {
        var input = el.querySelector('input[data-key="' + key + '"]');
        return input ? input.value : '';
    }

    function connect(c) {
        UI.toast('Connecting...');
        Xtream.login(c).then(function (info) {
            var exp = info.exp_date ? new Date(info.exp_date * 1000).toLocaleDateString('en-GB') : '';
            UI.toast('Connected' + (exp ? ' · subscription until ' + exp : ''));
            Store.set('lastLive', null);
            render();
        }).catch(function (e) {
            UI.toast('Could not connect: ' + e.message);
        });
    }

    function toggle(key) {
        if (key === 'showAdult') {
            if (Lang.showAdult()) { Lang.setAdult(false); afterFilterChange(true); return; }
            Pin.ask(function (ok) {
                if (!ok) { UI.toast('Wrong PIN'); return; }
                Lang.setAdult(true);
                UI.toast('Adult groups shown until the TV is switched off');
                afterFilterChange(true);
            });
            return;
        }
        Store.set(key, !Store.get(key, false));
        afterFilterChange();
    }

    // adultOnly: the PIN toggle. The search index already holds adult titles (hidden until
    // unlocked), so only the language switch needs a rebuild.
    function afterFilterChange(adultOnly) {
        // Lists are rebuilt with the new filter next time Live TV / Movies / Series open.
        Views.live.reset();
        Views.library.reset();
        if (!adultOnly) Search.invalidate();
        render();
    }

    function choiceLabel(r) {
        if (r.wallpaper) {
            var c = Store.get('wallpaper', -1);
            return c < 0 ? 'A different one each day' : (Views.home.wallpapers[c] ? Views.home.wallpapers[c].name : 'Photo ' + (c + 1));
        }
        var cur = Store.get(r.key, r.def);
        for (var i = 0; i < r.opts.length; i++) if (r.opts[i][0] === cur) return r.opts[i][1];
        return r.opts[0][1];
    }

    function cycleChoice(r, step) {
        if (r.wallpaper) {
            var n = Views.home.wallpapers.length;
            var c = Store.get('wallpaper', -1);
            // Order: Daily(-1), 0..n-1
            var seq = [-1];
            for (var k = 0; k < n; k++) seq.push(k);
            var pos = seq.indexOf(c);
            if (pos < 0) pos = 0;
            Store.set('wallpaper', seq[(pos + step + seq.length) % seq.length]);
            render();
            return;
        }
        var vals = r.opts.map(function (o) { return o[0]; });
        var ci = vals.indexOf(Store.get(r.key, r.def));
        if (ci < 0) ci = 0;
        Store.set(r.key, vals[(ci + step + vals.length) % vals.length]);
        render();
    }

    function addInput() {
        var all = Object.keys(hdmi).map(Number);
        if (!all.length) all = [1, 2, 3, 4];
        all.sort(function (a, b) { return a - b; });
        var used = Inputs.usedPorts();
        var free = all.filter(function (p) { return used.indexOf(p) < 0; });
        if (!free.length) { UI.toast('Every HDMI port is already added'); return; }
        Inputs.add(free[0]);
        UI.toast('Added HDMI ' + free[0] + '. Left and right to name it.');
        build();
        for (var i = 0; i < rows.length; i++) if (rows[i].key === 'input' + (Inputs.list().length - 1)) idx = i;
        render();
    }

    window.Views.settings = {
        mount: function (root) {
            el = document.createElement('div');
            el.className = 'settings';
            root.appendChild(el);
            build();
            idx = 0;
            picker = null;
            about = false;
            multi = null;
            render();
            Platform.hdmiStatus().then(function (s) { hdmi = s; render(); }).catch(function () { /* ports still selectable */ });
        },
        unmount: function () {},
        onKey: function (a) {
            if (Pin.isOpen()) return Pin.onKey(a);
            if (multi) return multiKey(a);
            if (picker) return pickerKey(a);
            if (about) {
                if (a.type === 'back') { about = false; render(); }
                return true;
            }
            var r = rows[idx];
            switch (a.type) {
                case 'up': if (idx > 0) idx--; break;
                case 'down': if (idx < rows.length - 1) idx++; break;
                case 'left': case 'right':
                    if (r.kind === 'inputrow') { Inputs.cyclePreset(r.i, a.type === 'left' ? -1 : 1); build(); }
                    if (r.kind === 'dockapp') {
                        var to = Apps.move(r.i, a.type === 'left' ? -1 : 1);
                        build();
                        idx += to - r.i;
                    }
                    if (r.kind === 'choice') cycleChoice(r, a.type === 'left' ? -1 : 1);
                    if (r.kind === 'toggle') toggle(r.key);
                    break;
                case 'ok':
                    if (r.kind === 'field') {
                        // Opens the TV's on-screen keyboard; values are read when Connect is pressed.
                        el.querySelector('input[data-key="' + r.key + '"]').focus();
                        return true;
                    }
                    if (r.key === 'connect') connect({ servers: Xtream.parseServers(value('server')), user: value('user'), pass: value('pass') });
                    if (r.kind === 'dockapp') {
                        Apps.remove(r.i);
                        UI.toast(r.app.label + ' removed from the dock');
                        build();
                        if (idx >= rows.length) idx = rows.length - 1;
                        render();
                    }
                    if (r.key === 'addApp') { openPicker(); return true; }
                    if (r.kind === 'inputrow') {
                        Inputs.remove(r.i);
                        UI.toast(r.input.name + ' removed');
                        build();
                        if (idx >= rows.length) idx = rows.length - 1;
                        render();
                        return true;
                    }
                    if (r.key === 'addInput') { addInput(); return true; }
                    if (r.key === 'about') { about = true; render(); return true; }
                    if (r.key === 'pickCountries') { openMulti('countries'); return true; }
                    if (r.key === 'townAuto') {
                        // Opt-in: sends the TV's internet address to ip-api.com (see the privacy line in About).
                        Weather.useAuto().then(function (w) {
                            UI.toast(w ? 'Weather for ' + Weather.place() : 'Could not find the town');
                            render();
                        });
                        return true;
                    }
                    if (r.key === 'pickLangs') { openMulti('langs'); return true; }
                    if (r.key === 'demo') connect({ servers: ['demo'], user: 'demo', pass: 'demo' });
                    if (r.key === 'next') { var n = Xtream.nextServer(); UI.toast(n ? 'Now using ' + n : 'Only one server configured'); render(); }
                    if (r.kind === 'choice') cycleChoice(r, 1);
                    if (r.kind === 'toggle') toggle(r.key);
                    return true;
                case 'back': App.back(); return true;
                default: return true;
            }
            // Re-render keeps typed-but-unsaved values: copy them over first.
            var typed = {};
            Array.prototype.forEach.call(el.querySelectorAll('input'), function (i) { typed[i.getAttribute('data-key')] = i.value; });
            render();
            Object.keys(typed).forEach(function (k) { el.querySelector('input[data-key="' + k + '"]').value = typed[k]; });
            return true;
        }
    };
})();
