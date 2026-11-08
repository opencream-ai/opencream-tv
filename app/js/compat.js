/* Compatibility shims for older Samsung TVs. 2019 sets (Tizen 5.0) run Chromium 63, which has no
   AbortController. Everything else the app uses (fetch streaming, TextDecoder, String.normalize,
   classList.toggle(name, force), Object.assign, Promise, IndexedDB) is already in Chromium 63. */
(function () {
    'use strict';

    var hasAbort = typeof AbortController !== 'undefined';

    // A controller-like object. When AbortController exists it is a thin wrapper; otherwise `signal`
    // is undefined (fetch simply ignores it) and callers lean on reader.cancel() / the timeout race
    // below to stop a request, since the fetch itself cannot be truly aborted.
    function canceller() {
        if (hasAbort) {
            var c = new AbortController();
            return { signal: c.signal, abort: function () { try { c.abort(); } catch (e) {} } };
        }
        return { signal: undefined, abort: function () {} };
    }

    // fetch with a whole-request timeout that works with or without AbortController. With it, the
    // request is really cancelled; without it, the pending fetch is left to finish unread while the
    // caller gets a timely rejection.
    function fetchTimeout(url, opts, ms) {
        opts = opts || {};
        var c = canceller();
        if (c.signal) opts.signal = c.signal;
        var real = fetch(url, opts);
        if (c.signal) {
            var timer = setTimeout(function () { c.abort(); }, ms);
            return real.then(function (r) { clearTimeout(timer); return r; },
                function (e) { clearTimeout(timer); throw e; });
        }
        // No AbortController: race the fetch against a timeout rejection.
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = setTimeout(function () { if (!settled) { settled = true; reject(new Error('timeout')); } }, ms);
            real.then(function (r) { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } },
                function (e) { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
        });
    }

    if (!hasAbort && window.Log) Log.info('compat: no AbortController (old TV), using fallbacks');

    // Flex `gap` needs Chromium 84; 2019-2020 sets ignore it. Measure it once and let the CSS fall
    // back to margins (.no-flexgap rules at the end of style.css).
    var hasFlexGap = (function () {
        var box = document.createElement('div'), a = document.createElement('div'), b = document.createElement('div');
        box.style.cssText = 'display:flex;flex-direction:column;gap:1px;position:absolute;visibility:hidden';
        box.appendChild(a); box.appendChild(b);
        (document.body || document.documentElement).appendChild(box);
        var ok = box.scrollHeight === 1;
        box.parentNode.removeChild(box);
        return ok;
    })();
    if (!hasFlexGap) {
        document.documentElement.className += ' no-flexgap';
        if (window.Log) Log.info('compat: no flex gap (old TV), using margins');
    }

    window.Net = { hasAbort: hasAbort, canceller: canceller, fetchTimeout: fetchTimeout };
})();
