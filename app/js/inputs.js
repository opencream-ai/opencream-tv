/* HDMI inputs on the dock. Each input is a name + icon bound to one HDMI port the TV reports
   (tizen.systeminfo VIDEOSOURCE). Replaces the old fixed Xbox/Switch pair and migrates it on
   first run, so an existing household keeps its console assignments. Store key: 'inputs'. */
(function () {
    'use strict';

    // Name presets; choosing one also sets the matching icon. 'hdmi' is the generic fallback.
    var PRESETS = [
        { name: 'Xbox', icon: 'xbox' },
        { name: 'PlayStation', icon: 'playstation' },
        { name: 'Nintendo Switch', icon: 'nintendoswitch' },
        { name: 'Laptop', icon: 'laptop' },
        { name: 'PC', icon: 'laptop' },
        { name: 'Apple TV', icon: 'tvbox' },
        { name: 'Soundbar', icon: 'hdmi' },
        { name: 'Blu-ray', icon: 'hdmi' }
    ];

    // Old shape was { xbox: port|null, nswitch: port|null }. New shape is an array of
    // { name, icon, port }. Convert once, keeping only ports that were actually assigned.
    (function migrate() {
        var cur = Store.get('inputs', null);
        if (cur && !Array.isArray(cur)) {
            var list = [];
            if (cur.xbox) list.push({ name: 'Xbox', icon: 'xbox', port: cur.xbox });
            if (cur.nswitch) list.push({ name: 'Switch', icon: 'nintendoswitch', port: cur.nswitch });
            Store.set('inputs', list);
        } else if (cur == null) {
            Store.set('inputs', []);
        }
    })();

    function list() {
        var l = Store.get('inputs', []);
        return Array.isArray(l) ? l : [];
    }
    function save(l) { Store.set('inputs', l); }
    function usedPorts() { return list().map(function (i) { return i.port; }); }

    function add(port) {
        var l = list();
        l.push({ name: 'HDMI ' + port, icon: 'hdmi', port: port });
        save(l);
    }
    function remove(i) { var l = list(); l.splice(i, 1); save(l); }

    // Left/right on an input row steps through "HDMI n" (generic) and the name presets; the icon
    // follows the name. The port stays fixed (chosen when the input was added).
    function cyclePreset(i, step) {
        var l = list(), it = l[i];
        if (!it) return;
        var seq = [{ name: 'HDMI ' + it.port, icon: 'hdmi' }].concat(PRESETS);
        var pos = 0;
        for (var j = 0; j < seq.length; j++) if (seq[j].name === it.name) pos = j;
        var next = seq[(pos + step + seq.length) % seq.length];
        it.name = next.name; it.icon = next.icon;
        save(l);
    }

    window.Inputs = { list: list, add: add, remove: remove, cyclePreset: cyclePreset, usedPorts: usedPorts, PRESETS: PRESETS };
})();
