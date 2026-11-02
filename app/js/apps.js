/* Apps: the streaming apps on the dock. Which apps are installed comes from the TV; the user picks
   and orders them in Settings (store key 'dockApps'). Known services get our own monochrome glyph,
   everything else shows the TV's icon. Checked on the QN90C 31.10.2026: getAppsInfo returns ~250
   entries, most of them system parts, so only known services and store apps with an icon are kept. */
(function () {
    'use strict';

    // ids: every id the service is known under (store package id and Tizen app id; they differ by
    // region and model year). names: matched against the app name when no id matches.
    var KNOWN = [
        { key: 'youtube', label: 'YouTube', icon: 'youtube', ids: ['111299001912', '9Ur5IzDKqV.TizenYouTube'], names: /^youtube$/i },
        { key: 'netflix', label: 'Netflix', icon: 'netflix', ids: ['3201907018807', 'org.tizen.netflix-app'], names: /^netflix$/i },
        { key: 'prime', label: 'Prime Video', icon: 'primevideo', ids: ['3201910019365', 'org.tizen.primevideo'], names: /^prime video$/i },
        { key: 'disney', label: 'Disney+', ids: ['3201901017640', 'MCmYXNxgcu.DisneyPlus'], names: /^disney\s*\+/i },
        { key: 'appletv', label: 'Apple TV', ids: ['3201807016597'], names: /^apple tv/i },
        { key: 'max', label: 'Max', names: /^(hbo )?max$/i },
        { key: 'canal', label: 'CANAL+', ids: ['QmpwflxWdt.CanalPlusLauncher'], names: /^canal\s*\+/i },
        { key: 'spotify', label: 'Spotify', ids: ['3201606009684', 'rJeHak5zRg.Spotify'], names: /^spotify/i },
        { key: 'plex', label: 'Plex', ids: ['3201512006963'], names: /^plex$/i },
        { key: 'twitch', label: 'Twitch', names: /^twitch$/i },
        { key: 'xboxapp', label: 'Xbox', icon: 'xbox', ids: ['GHI3a0zMSx.XboxGamePass'], names: /^xbox$/i }
    ];

    // The three that were on the dock before it became configurable.
    var DEFAULT = [
        { id: '111299001912', label: 'YouTube', icon: 'youtube' },
        { id: '3201907018807', label: 'Netflix', icon: 'netflix' },
        { id: '3201910019365', label: 'Prime Video', icon: 'primevideo' }
    ];

    var installedCache = null;

    function known(id, name) {
        for (var i = 0; i < KNOWN.length; i++) {
            var k = KNOWN[i];
            if (k.ids && k.ids.indexOf(id) >= 0) return k;
        }
        for (var j = 0; j < KNOWN.length; j++) if (KNOWN[j].names.test(name || '')) return KNOWN[j];
        return null;
    }

    // Keep an entry if it is a known service, or a store app (10-character package prefix) with an
    // icon. Cobalt entries are YouTube engine stubs, our own app is not offered.
    function keep(a) {
        // cobalt: YouTube engine stubs; -dummy: placeholders for apps that are not really installed
        // (org.tizen.primevideo-dummy next to the real org.tizen.primevideo, seen 31.10.2026).
        if (/cobalt|dummy/i.test(a.id) || a.id === tizen.application.getCurrentApplication().appInfo.id) return false;
        if (known(a.id, a.name)) return true;
        if (/privacy|security center|user guide|public value|e-?manual/i.test(a.name || '')) return false;
        return /^[A-Za-z0-9]{10}\./.test(a.id) && !!a.iconPath;
    }

    // [{ id, label, icon, iconPath }] sorted by name, one entry per known service.
    function installed() {
        if (installedCache) return Promise.resolve(installedCache);
        return Platform.installedApps().then(function (list) {
            var seen = {}, out = [];
            (list || []).filter(function (a) { return a.show !== false && keep(a); }).forEach(function (a) {
                var k = known(a.id, a.name);
                var key = k ? k.key : a.id;
                var entry = { id: a.id, label: k ? k.label : a.name, icon: k && k.icon ? k.icon : null, iconPath: a.iconPath || null };
                if (seen[key]) {
                    // Same service listed twice: keep the entry that has an icon (the real app).
                    if (!seen[key].iconPath && entry.iconPath) { out[out.indexOf(seen[key])] = entry; seen[key] = entry; }
                    return;
                }
                seen[key] = entry;
                out.push(entry);
            });
            out.sort(function (x, y) { return x.label.localeCompare(y.label); });
            installedCache = out;
            return out;
        }).catch(function () { return []; });
    }

    function dock() {
        var d = Store.get('dockApps', null);
        return d && d.length !== undefined ? d : DEFAULT.slice();
    }

    function save(list) { Store.set('dockApps', list); }

    function inDock(id, list) {
        var k = known(id, '');
        return (list || dock()).some(function (d) {
            return d.id === id || (k && k.ids && k.ids.indexOf(d.id) >= 0);
        });
    }

    function add(app) {
        var list = dock();
        if (inDock(app.id, list)) return;
        list.push({ id: app.id, label: app.label, icon: app.icon, iconPath: app.iconPath });
        save(list);
    }

    function remove(i) { var list = dock(); list.splice(i, 1); save(list); }

    function move(i, step) {
        var list = dock(), j = i + step;
        if (j < 0 || j >= list.length) return i;
        var t = list[i]; list[i] = list[j]; list[j] = t;
        save(list);
        return j;
    }

    // Glyph if we have one, else the TV's own icon (shown in greyscale until focused, see style.css).
    function iconHtml(app) {
        if (app.icon && Icons[app.icon]) return Icons[app.icon];
        if (app.iconPath) return '<img class="appimg" src="' + UI.esc(app.iconPath) + '" alt="">';
        return '<span class="appinitial">' + UI.esc((app.label || '?').charAt(0)) + '</span>';
    }

    window.Apps = {
        installed: installed,
        dock: dock,
        add: add,
        remove: remove,
        move: move,
        inDock: inDock,
        iconHtml: iconHtml,
        forget: function () { installedCache = null; },
        // Fallback for the picker when the TV lists nothing: every known service, by its first id.
        knownList: function () {
            return KNOWN.filter(function (k) { return k.ids; }).map(function (k) {
                return { id: k.ids[0], label: k.label, icon: k.icon || null, iconPath: null };
            });
        }
    };
})();
