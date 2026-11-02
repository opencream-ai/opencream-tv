/* Everything that talks to the TV: remote keys, launching apps, HDMI inputs.
   Outside the TV (desktop browser preview) the same calls fall back to keyboard and logs. */
(function () {
    'use strict';

    var isTV = typeof window.tizen !== 'undefined';

    // Keys the TV only delivers to apps that ask for them.
    var EXTRA_KEYS = ['ChannelUp', 'ChannelDown', 'PreviousChannel', 'ChannelList', 'Info',
        'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

    var NAME_TO_ACTION = {
        ChannelUp: 'chUp', ChannelDown: 'chDown', PreviousChannel: 'prevCh', ChannelList: 'list',
        Info: 'info', MediaPlayPause: 'playPause', MediaPlay: 'play', MediaPause: 'pause',
        MediaStop: 'stop', MediaFastForward: 'ff', MediaRewind: 'rw',
        ColorF0Red: 'red', ColorF1Green: 'green', ColorF2Yellow: 'yellow', ColorF3Blue: 'blue'
    };

    // Arrows, OK and Back are the same everywhere; the rest is the desktop keyboard stand-in.
    var codeToAction = {
        37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok',
        10009: 'back', 27: 'back', 8: 'back',
        33: 'chUp', 34: 'chDown', 73: 'info', 76: 'list', 70: 'yellow',
        32: 'playPause', 190: 'ff', 188: 'rw', 80: 'prevCh'
    };

    if (isTV) {
        EXTRA_KEYS.forEach(function (name) {
            try {
                tizen.tvinputdevice.registerKey(name);
                if (NAME_TO_ACTION[name]) codeToAction[tizen.tvinputdevice.getKey(name).code] = NAME_TO_ACTION[name];
            } catch (e) { /* this remote/firmware does not offer the key */ }
        });
    }

    function actionFor(e) {
        if (e.keyCode >= 48 && e.keyCode <= 57) return { type: 'digit', n: e.keyCode - 48 };
        var type = codeToAction[e.keyCode];
        return type ? { type: type } : null;
    }

    function launchApp(id) {
        return new Promise(function (resolve, reject) {
            if (!isTV) { UI.toast('Would open ' + id); return resolve(); }
            tizen.application.launch(id, resolve, reject);
        });
    }

    function installedApps() {
        return new Promise(function (resolve) {
            if (!isTV) return resolve([]);
            tizen.application.getAppsInfo(resolve, function () { resolve([]); });
        });
    }

    function videoSources() {
        return new Promise(function (resolve, reject) {
            if (!isTV) {
                return resolve({
                    connected: [{ type: 'HDMI', number: 1 }, { type: 'HDMI', number: 2 }],
                    disconnected: [{ type: 'HDMI', number: 3 }, { type: 'HDMI', number: 4 }]
                });
            }
            tizen.systeminfo.getPropertyValue('VIDEOSOURCE', resolve, reject);
        });
    }

    // { 1: true, 2: false, ... } for every HDMI port the TV knows about.
    function hdmiStatus() {
        return videoSources().then(function (info) {
            var status = {};
            (info.disconnected || []).forEach(function (s) { if (s.type === 'HDMI') status[s.number] = false; });
            (info.connected || []).forEach(function (s) { if (s.type === 'HDMI') status[s.number] = true; });
            return status;
        });
    }

    // Switch the TV to an HDMI port and hand over to Samsung's own viewer,
    // so Game Mode / ALLM / VRR behave exactly as when choosing the input normally.
    function openHdmi(n) {
        if (!isTV) { UI.toast('Would switch to HDMI ' + n); return Promise.resolve(); }
        return videoSources().then(function (info) {
            var all = (info.connected || []).concat(info.disconnected || []);
            var src = all.filter(function (s) { return s.type === 'HDMI' && s.number === n; })[0];
            if (!src) throw new Error('HDMI ' + n + ' not found');
            return new Promise(function (resolve, reject) {
                tizen.tvwindow.setSource(src, resolve, reject, 'MAIN');
            });
        }).then(function () {
            return launchApp('org.tizen.tv-viewer');
        });
    }

    // Samsung's own Smart Hub. csfs is the first-screen launcher present on Tizen 5–8; if a
    // model ever lacks it, fall back to the sidebar home. This is the way back to the TV's menu,
    // and the recovery path if the Home button is ever remapped to this app.
    function openSamsungHome() {
        if (!isTV) { UI.toast('Would open Samsung Home'); return Promise.resolve(); }
        return launchApp('com.samsung.tv.csfs').catch(function () {
            return launchApp('com.samsung.tv.home.sidebar');
        });
    }

    window.Platform = {
        isTV: isTV,
        actionFor: actionFor,
        launchApp: launchApp,
        installedApps: installedApps,
        hdmiStatus: hdmiStatus,
        openHdmi: openHdmi,
        openSamsungHome: openSamsungHome
    };
})();
