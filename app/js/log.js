/* Logging. On the TV there is no console to look at, so when a log address is configured
   (config.local.js → logUrl) every line is also sent to a small log server on the Mac. */
(function () {
    'use strict';

    var cfg = window.LOCAL_CONFIG || {};

    function send(level, msg) {
        var line = new Date().toISOString().slice(11, 19) + ' ' + level + ' ' + msg;
        if (level === 'ERROR') console.error(line); else console.log(line);
        if (!cfg.logUrl) return;
        try {
            fetch(cfg.logUrl, { method: 'POST', body: line, mode: 'no-cors' }).catch(function () { /* log server not running */ });
        } catch (e) { /* ignore */ }
    }

    window.addEventListener('error', function (e) {
        send('ERROR', (e.message || 'error') + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno);
    });
    window.addEventListener('unhandledrejection', function (e) {
        send('ERROR', 'unhandled: ' + (e.reason && (e.reason.message || e.reason.name) || e.reason));
    });

    window.Log = {
        info: function (m) { send('INFO', m); },
        error: function (m) { send('ERROR', m); }
    };
})();
