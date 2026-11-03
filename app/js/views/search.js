/* Search across channels (including today's sport events), movies and series. */
(function () {
    'use strict';

    window.Views = window.Views || {};

    var TYPE = { live: 'TV', movie: 'Movie', series: 'Series' };
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // "Now", "18:30" (today), "Sat 18:30" (other days)
    function when(p) {
        var now = Date.now();
        if (p.s <= now) return 'Now';
        var d = new Date(p.s), today = new Date();
        return (d.toDateString() === today.toDateString() ? '' : DAYS[d.getDay()] + ' ') + UI.clock(d);
    }
    var lastQuery = '', zone = 'input', results, el, input, statusTimer, typeTimer;

    function row(r) {
        if (r.t === 'epg') {
            return '<span class="badge b-epg' + (r.s <= Date.now() ? ' now' : '') + '">' + when(r) + '</span>' +
                (r.ch.i ? '<span class="logo"><img src="' + UI.esc(r.ch.i) + '" onerror="this.parentNode.remove()"></span>' : '') +
                '<span class="name">' + UI.esc(r.n) + '<span class="sub">' + UI.esc(r.ch.n) + '</span></span>';
        }
        return '<span class="badge b-' + r.t + '">' + TYPE[r.t] + '</span>' +
            (r.i ? '<span class="logo"><img src="' + UI.esc(r.i) + '" onerror="this.parentNode.remove()"></span>' : '') +
            '<span class="name">' + UI.esc(r.n) + '</span>';
    }

    function run() {
        lastQuery = input.value;
        var hits = Search.find(lastQuery, 300);
        results.set(hits);
        if (lastQuery.trim() && !hits.length) results.el.innerHTML = '<div class="empty">Nothing found for "' + UI.esc(lastQuery) + '"</div>';
    }

    function setZone(z) {
        zone = z;
        el.querySelector('.sfield').classList.toggle('focus', z === 'input');
        results.setActive(z === 'list');
    }

    function open(r) {
        if (r.t === 'epg') {
            var c = r.ch;
            if (r.s <= Date.now() + 5 * 60e3) App.go('live', { play: { stream_id: c.id, name: c.n, stream_icon: c.i, category_id: c.c } });
            else UI.toast('Starts ' + when(r) + ' on ' + c.n);
            return;
        }
        if (r.t === 'live') App.go('live', { play: { stream_id: r.id, name: r.n, stream_icon: r.i, category_id: r.c } });
        else if (r.t === 'movie') App.go('library', { kind: 'movies', open: { stream_id: r.id, name: r.n, stream_icon: r.i, container_extension: r.x } });
        else App.go('library', { kind: 'series', open: { series_id: r.id, name: r.n, cover: r.i } });
    }

    window.Views.search = {
        mount: function (root) {
            el = document.createElement('div');
            el.className = 'search';
            el.innerHTML = '<div class="sfield glass">' + Icons.search + '<input type="text" placeholder="Channels, programmes, sport events, movies, series" autocomplete="off" spellcheck="false"></div>' +
                '<div class="sstatus"></div><div class="col results"></div>';
            root.appendChild(el);
            input = el.querySelector('input');
            input.value = lastQuery;
            results = new UI.VList(el.querySelector('.results'), { rowH: 80, renderRow: row });
            input.addEventListener('input', function () {
                clearTimeout(typeTimer);
                typeTimer = setTimeout(run, 350);
            });
            input.addEventListener('blur', function () {
                run();
                if (results.items.length) setZone('list');
            });
            var paintStatus = function () { el.querySelector('.sstatus').textContent = Search.status(); };
            paintStatus();
            statusTimer = setInterval(paintStatus, 2000);
            Search.refresh();
            if (lastQuery) run();
            setZone(lastQuery && results.items.length ? 'list' : 'input');
        },
        unmount: function () { clearInterval(statusTimer); clearTimeout(typeTimer); },
        onKey: function (a) {
            if (zone === 'input') {
                if (a.type === 'ok') { input.focus(); return true; }
                if (a.type === 'down' && results.items.length) setZone('list');
                if (a.type === 'back') App.back();
                return true;
            }
            switch (a.type) {
                case 'up':
                    if (results.index === 0) { if (!a.heldMs) setZone('input'); }
                    else results.move(-UI.holdStep(a.heldMs, 8));
                    break;
                case 'down': results.move(UI.holdStep(a.heldMs, 8)); break;
                case 'chUp': results.move(-8); break;
                case 'chDown': results.move(8); break;
                case 'ok': if (results.current()) open(results.current()); break;
                case 'back': setZone('input'); break;
            }
            return true;
        }
    };
})();
