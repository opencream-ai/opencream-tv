/* Settings and history kept on the TV (localStorage). Credentials never leave the TV. */
(function () {
    'use strict';

    function get(key, fallback) {
        try {
            var v = localStorage.getItem('calm.' + key);
            return v == null ? fallback : JSON.parse(v);
        } catch (e) {
            return fallback;
        }
    }

    function set(key, value) {
        localStorage.setItem('calm.' + key, JSON.stringify(value));
    }

    // Favourite live channels as small records, so they show without loading their group.
    function favourites() {
        return get('favs', []).filter(function (f) { return f && typeof f === 'object'; });
    }

    function isFavourite(streamId) {
        return favourites().some(function (f) { return f.stream_id === streamId; });
    }

    function toggleFavourite(ch) {
        var favs = favourites();
        var had = isFavourite(ch.stream_id);
        favs = favs.filter(function (f) { return f.stream_id !== ch.stream_id; });
        if (!had) favs.push({ stream_id: ch.stream_id, name: ch.name, stream_icon: ch.stream_icon, category_id: ch.category_id });
        set('favs', favs);
        return !had;
    }

    // Favourite films and series (hold OK on a poster), newest first, in one list for both
    // libraries. Each keeps just enough of the title to show its poster and open it.
    var LIB_FIELDS = ['stream_id', 'series_id', 'name', 'stream_icon', 'cover', 'container_extension', 'tmdb'];

    function libKey(kind, item) { return kind === 'movies' ? 'm' + item.stream_id : 's' + item.series_id; }

    function libList() {
        return get('libFavs', []).filter(function (f) { return f && f.key && f.item; });
    }

    function libFavourites(kind) {
        return libList().filter(function (f) { return f.kind === kind; }).map(function (f) { return f.item; });
    }

    function isLibFavourite(kind, item) {
        var key = libKey(kind, item);
        return libList().some(function (f) { return f.key === key; });
    }

    function toggleLibFavourite(kind, item) {
        var key = libKey(kind, item), had = isLibFavourite(kind, item);
        var list = libList().filter(function (f) { return f.key !== key; });
        if (!had) {
            var small = {};
            LIB_FIELDS.forEach(function (k) { if (item[k] != null) small[k] = item[k]; });
            list.unshift({ key: key, kind: kind, item: small });
        }
        set('libFavs', list);
        return !had;
    }

    // One value from config.local.js: a list or a comma-separated string, taken literally (the
    // installers escape quotes and backslashes; no decoding, so a password with "%41" stays as is).
    // Placeholders the installer did not fill in (__OCTV_...) count as empty.
    function cfgValue(v) {
        if (v == null) return '';
        if (Object.prototype.toString.call(v) === '[object Array]') return v.join(',');
        v = String(v);
        return v.indexOf('__OCTV_') === 0 ? '' : v;
    }

    function cfgList(v) {
        return cfgValue(v).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    }

    // Household settings shipped with the package (config.local.js) seed the IPTV login once,
    // and again whenever the shipped account or server list changes (a reinstall with new values).
    // A missing or broken config simply means no pre-fill: the app then opens its welcome screen.
    (function seed() {
        var cfg;
        try {
            var x = window.LOCAL_CONFIG && window.LOCAL_CONFIG.xtream;
            if (!x) return;
            cfg = { user: cfgValue(x.user), pass: cfgValue(x.pass), servers: cfgList(x.servers), streamServers: cfgList(x.streamServers) };
        } catch (e) { return; }
        if (!cfg.user || !cfg.servers.length) return;
        var stamp = cfg.user + '|' + cfg.servers.join(',') + '|' + cfg.streamServers.join(',');
        if (get('seeded', '') === stamp) {
            // Repair: an older Settings login dropped streamServers from the saved login (31.10.2026).
            var cur = get('xtream', null);
            if (cur && cur.user === cfg.user && !(cur.streamServers && cur.streamServers.length) && cfg.streamServers.length) {
                cur.streamServers = cfg.streamServers.slice();
                set('xtream', cur);
            }
            return;
        }
        // streamServers (optional): the servers that really deliver video; the others serve lists only.
        set('xtream', { servers: cfg.servers.slice(), streamServers: cfg.streamServers.slice(),
            active: 0, user: cfg.user, pass: cfg.pass, liveExt: 'ts' });
        set('seeded', stamp);
        set('lastLive', null);
    })();

    // Resume points for movies and episodes, newest first, capped at 20.
    function resumeList() { return get('resume', []); }

    function resumeAt(key) {
        var hit = resumeList().filter(function (r) { return r.key === key; })[0];
        return hit ? hit.pos : 0;
    }

    function saveResume(entry) {
        var list = resumeList().filter(function (r) { return r.key !== entry.key; });
        var nearEnd = entry.dur && entry.pos > entry.dur - 120000;
        if (entry.pos > 60000 && !nearEnd) list.unshift(entry);
        set('resume', list.slice(0, 20));
    }

    window.Store = {
        get: get,
        set: set,
        favourites: favourites,
        isFavourite: isFavourite,
        toggleFavourite: toggleFavourite,
        libFavourites: libFavourites,
        isLibFavourite: isLibFavourite,
        toggleLibFavourite: toggleLibFavourite,
        resumeList: resumeList,
        resumeAt: resumeAt,
        saveResume: saveResume
    };
})();
