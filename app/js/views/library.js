/* Movies and Series: categories on the left, posters on the right, then a detail page.
   Series detail lists seasons and episodes; playing an episode queues the rest of the season. */
(function () {
    'use strict';

    window.Views = window.Views || {};

    var COLS = 6, COL_W = 236, ROW_H = 392;

    // One saved state per library so returning lands where you left off.
    var states = {};

    var kind, st, el, catList, grid, detailEl, catTimer;

    function api() {
        return kind === 'movies'
            ? { cats: Xtream.vodCategories, items: Xtream.vodStreams, title: 'Movies' }
            : { cats: Xtream.seriesCategories, items: Xtream.series, title: 'Series' };
    }

    function poster(item) { return item.stream_icon || item.cover || ''; }

    function cell(item) {
        var p = poster(item);
        return '<div class="poster">' + (p ? '<img src="' + UI.esc(p) + '" onerror="this.remove()">' : '') +
            '<span class="fallback">' + UI.esc(Xtream.clean(item.name)) + '</span></div><div class="cap">' + UI.esc(Xtream.clean(item.name)) + '</div>';
    }

    function setCol(col) {
        st.col = col;
        catList.setActive(col === 'cats');
        grid.setActive(col === 'grid');
    }

    function loadItems(catId, keepIndex) {
        st.catId = catId;
        grid.set([]);
        el.querySelector('.count').textContent = '';
        return api().items(catId).then(function (items) {
            if (st.catId !== catId) return;
            st.items = items;
            grid.set(items, keepIndex ? st.gridIdx : 0);
            el.querySelector('.count').textContent = items.length + (items.length === 1 ? ' title' : ' titles');
        }).catch(function (e) { UI.toast('Could not load: ' + e.message); });
    }

    // ---------- detail ----------

    function closeDetail() {
        st.detail = null;
        detailEl.classList.remove('show');
        detailEl.innerHTML = '';
    }

    function openDetail(item) {
        st.detail = { item: item, btn: 0, zone: 'buttons', season: 0, seasons: [], eps: null, epIdx: 0 };
        detailEl.classList.add('show');
        renderDetail();
        var load = kind === 'movies' ? Xtream.vodInfo(item.stream_id) : Xtream.seriesInfo(item.series_id);
        load.then(function (info) {
            if (!st.detail || st.detail.item !== item) return;
            st.detail.info = info.info || {};
            if (kind === 'series') {
                var eps = info.episodes || {};
                st.detail.seasons = Object.keys(eps).sort(function (a, b) { return a - b; }).map(function (s) {
                    return { n: s, eps: eps[s] };
                });
                st.detail.zone = st.detail.seasons.length ? 'eps' : 'buttons';
            }
            renderDetail();
        }).catch(function () { renderDetail(); });
    }

    function movieButtons(d) {
        var at = Store.resumeAt('m' + d.item.stream_id);
        return at ? [{ label: 'Resume from ' + UI.duration(at), start: at }, { label: 'Play from start', start: 0 }]
            : [{ label: 'Play', start: 0 }];
    }

    function renderDetail() {
        var d = st.detail;
        var info = d.info || {};
        var meta = [info.releasedate || info.releaseDate || info.year, info.genre, info.duration].filter(Boolean).map(function (s) {
            return String(s).slice(0, 40);
        });
        var html = '<div class="backdrop">' + (poster(d.item) ? '<img src="' + UI.esc(poster(d.item)) + '" onerror="this.remove()">' : '') + '</div>' +
            '<div class="dposter">' + (poster(d.item) ? '<img src="' + UI.esc(poster(d.item)) + '" onerror="this.remove()">' : '') + '</div>' +
            '<div class="dbody"><h1>' + UI.esc(Xtream.clean(d.item.name)) + '</h1>' +
            '<div class="dmeta">' + meta.map(UI.esc).join('<span class="sep"></span>') + '</div>' +
            '<p class="plot">' + UI.esc(info.plot || info.description || '') + '</p>';

        if (kind === 'movies') {
            html += '<div class="buttons">' + movieButtons(d).map(function (b, i) {
                return '<div class="btn' + (i === d.btn ? ' focus' : '') + '">' + b.label + '</div>';
            }).join('') + '</div>';
        } else if (d.seasons.length) {
            html += '<div class="seasons">' + d.seasons.map(function (s, i) {
                return '<div class="tab' + (i === d.season ? ' on' : '') + (d.zone === 'seasons' && i === d.season ? ' focus' : '') + '">Season ' + UI.esc(s.n) + '</div>';
            }).join('') + '</div><div class="eps"></div>';
        } else if (d.info) {
            html += '<div class="muted">No episodes found</div>';
        }
        detailEl.innerHTML = html + '</div>';

        if (kind === 'series' && d.seasons.length) {
            d.eps = new UI.VList(detailEl.querySelector('.eps'), {
                rowH: 84,
                renderRow: function (ep) {
                    var at = Store.resumeAt('e' + ep.id);
                    var dur = ep.info && ep.info.duration ? ep.info.duration.replace(/^00:/, '') : '';
                    return '<span class="n">' + UI.esc(ep.episode_num) + '</span><span class="name">' + UI.esc(ep.title) + '</span>' +
                        (at ? '<span class="resume">' + UI.duration(at) + '</span>' : '') + '<span class="dur">' + UI.esc(dur) + '</span>';
                }
            });
            d.eps.set(d.seasons[d.season].eps, d.epIdx);
            d.eps.setActive(d.zone === 'eps');
        }
    }

    function playMovie(item, startMs) {
        // Serializable descriptor (so Continue watching can rebuild it); the player resolves the URL.
        App.go('player', {
            type: 'movie', id: item.stream_id, container: item.container_extension || 'mp4', tmdb: item.tmdb || '',
            title: Xtream.clean(item.name), sub: 'Movie', poster: poster(item),
            key: 'm' + item.stream_id, startMs: startMs
        });
    }

    function playEpisode(d) {
        var season = d.seasons[d.season];
        var queue = season.eps.map(function (ep) {
            return {
                type: 'series', id: ep.id, container: ep.container_extension || 'mp4',
                seriesId: d.item.series_id, tmdb: d.item.tmdb || '', season: season.n, ep: ep.episode_num,
                title: Xtream.clean(d.item.name),
                sub: 'S' + season.n + ' E' + ep.episode_num + ' · ' + ep.title,
                poster: poster(d.item), key: 'e' + ep.id
            };
        });
        var first = queue[d.eps.index];
        App.go('player', Object.assign({}, first, {
            startMs: Store.resumeAt(first.key), queue: queue, qi: d.eps.index
        }));
    }

    function detailKey(a) {
        var d = st.detail;
        if (a.type === 'back') { closeDetail(); return true; }
        if (kind === 'movies') {
            var btns = movieButtons(d);
            if (a.type === 'left' && d.btn > 0) d.btn--;
            else if (a.type === 'right' && d.btn < btns.length - 1) d.btn++;
            else if (a.type === 'ok' || a.type === 'play' || a.type === 'playPause') { playMovie(d.item, btns[d.btn].start); return true; }
            renderDetail();
            return true;
        }
        if (!d.seasons.length) return true;
        if (d.zone === 'seasons') {
            if (a.type === 'left' && d.season > 0) { d.season--; d.epIdx = 0; }
            else if (a.type === 'right' && d.season < d.seasons.length - 1) { d.season++; d.epIdx = 0; }
            else if (a.type === 'down' || a.type === 'ok') d.zone = 'eps';
            renderDetail();
            return true;
        }
        switch (a.type) {
            case 'up': if (d.eps.index === 0) { d.zone = 'seasons'; renderDetail(); } else { d.eps.move(-1); d.epIdx = d.eps.index; } break;
            case 'down': d.eps.move(1); d.epIdx = d.eps.index; break;
            case 'chUp': d.eps.move(-5); d.epIdx = d.eps.index; break;
            case 'chDown': d.eps.move(5); d.epIdx = d.eps.index; break;
            case 'ok': case 'play': case 'playPause': playEpisode(d); break;
        }
        return true;
    }

    // ---------- screen ----------

    window.Views.library = {
        reset: function () { states = {}; },
        mount: function (root, params, restoring) {
            kind = params.kind;
            st = states[kind] = states[kind] || { cats: [], catIdx: 0, catId: null, items: [], gridIdx: 0, col: 'cats', detail: null };
            el = document.createElement('div');
            el.className = 'library';
            el.innerHTML = '<header class="lib-head"><h1>' + api().title + '</h1><span class="count"></span></header>' +
                '<div class="col cats"></div><div class="grid"></div><div class="detail"></div>';
            root.appendChild(el);
            detailEl = el.querySelector('.detail');
            catList = new UI.VList(el.querySelector('.cats'), {
                rowH: 60, renderRow: function (c) { return '<span class="name">' + UI.esc(c.name) + '</span>'; }
            });
            grid = new UI.VGrid(el.querySelector('.grid'), { cols: COLS, colW: COL_W, rowH: ROW_H, renderCell: cell });

            var ready = st.cats.length ? Promise.resolve() : api().cats().then(function (list) {
                var kept = list.filter(function (c) { return Lang.keepCategory(c.category_name); });
                // Categories without a language prefix ("Drama", "Family") count as "other" and the
                // language filter can remove every one of them. An empty list used to crash this
                // screen (sample channels, 02.11.2026): show everything except adult groups instead.
                if (!kept.length) kept = list.filter(function (c) { return !Lang.isAdult(c.category_name) || Lang.showAdult(); });
                st.cats = kept.map(function (c) { return { id: c.category_id, name: Xtream.clean(c.category_name) }; });
                st.catIdx = 0;
            });
            ready.then(function () {
                catList.set(st.cats, st.catIdx);
                setCol(st.col);
                var cat = st.cats[st.catIdx];
                if (!cat) { el.querySelector('.count').textContent = 'Your IPTV service lists no categories here'; return; }
                return loadItems(cat.id, restoring || st.catId === cat.id);
            }).then(function () {
                if (params.open && !restoring) { openDetail(params.open); return; }
                if (st.detail) {
                    var item = st.detail.item, keep = st.detail;
                    detailEl.classList.add('show');
                    st.detail = keep;
                    renderDetail();
                    if (!keep.info) openDetail(item);
                }
            }).catch(function (e) { UI.toast('IPTV service not reachable: ' + e.message); });
        },
        unmount: function () { clearTimeout(catTimer); },
        onKey: function (a) {
            if (st.detail) return detailKey(a);
            if (st.col === 'cats') {
                switch (a.type) {
                    case 'up': case 'down':
                        if (!catList.move(a.type === 'up' ? -1 : 1)) return true;
                        st.catIdx = catList.index;
                        clearTimeout(catTimer);
                        catTimer = setTimeout(function () { var c = catList.current(); if (c) loadItems(c.id); }, 350);
                        return true;
                    case 'right': case 'ok':
                        if (st.items.length) setCol('grid');
                        return true;
                    case 'back': App.back(); return true;
                }
                return true;
            }
            var page = Math.max(1, Math.floor(grid.el.clientHeight / ROW_H));
            switch (a.type) {
                case 'left': if (!grid.move(-1, 0)) setCol('cats'); break;
                case 'right': grid.move(1, 0); break;
                case 'up': grid.move(0, -1); break;
                case 'down': grid.move(0, 1); break;
                case 'chUp': grid.move(0, -page); break;
                case 'chDown': grid.move(0, page); break;
                case 'ok': case 'play': case 'playPause': if (grid.current()) openDetail(grid.current()); break;
                case 'back': setCol('cats'); break;
            }
            st.gridIdx = grid.index;
            return true;
        }
    };
})();
