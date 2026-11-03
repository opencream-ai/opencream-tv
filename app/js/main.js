/* App shell: a stack of screens, remote-key dispatch, and pausing when the TV switches away. */
(function () {
    'use strict';

    var root = document.getElementById('app');
    var stack = [];

    function top() { return stack[stack.length - 1]; }

    function mount(entry, restoring) {
        root.innerHTML = '';
        root.className = 'screen-' + entry.name;
        Views[entry.name].mount(root, entry.params || {}, restoring);
    }

    function go(name, params) {
        if (top()) Views[top().name].unmount();
        stack.push({ name: name, params: params });
        mount(top(), false);
    }

    // Replace the current screen without growing the history.
    function replace(name, params) {
        if (top()) Views[top().name].unmount();
        stack[stack.length - 1] = { name: name, params: params };
        mount(top(), false);
    }

    function back() {
        if (stack.length < 2) return;
        Views[top().name].unmount();
        stack.pop();
        mount(top(), true);
    }

    // IME keys: Done / Cancel on the TV's on-screen keyboard.
    var IME_DONE = 65376, IME_CANCEL = 65385;

    document.addEventListener('keydown', function (e) {
        var field = document.activeElement;
        if (field && (field.tagName === 'INPUT' || field.tagName === 'SELECT')) {
            if (e.keyCode === IME_DONE || e.keyCode === IME_CANCEL || e.keyCode === 13 || e.keyCode === 10009 || e.keyCode === 27 ||
                e.keyCode === 38 || e.keyCode === 40) {
                field.blur();
                e.preventDefault();
            }
            return;
        }
        var action = Platform.actionFor(e);
        if (!action || !top()) return;
        e.preventDefault();
        // How long this key has been held (or pressed again and again): lists and seeking speed up with it.
        // Timestamps, not e.repeat: Tizen does not set e.repeat reliably (03.11.2026).
        var now = Date.now();
        if (e.keyCode !== hold.code || now - hold.last > 600) { hold.code = e.keyCode; hold.start = now; }
        hold.last = now;
        action.heldMs = now - hold.start;
        var view = Views[top().name];
        // Views that use "hold OK" (e.g. favourite a channel) get OK on release, or okLong after 600 ms.
        // The Samsung remote has no colour buttons, so holding OK replaces Yellow (31.10.2026).
        // Safety: a lost keyup must not block OK for good; any other key resets the hold state.
        if (action.type !== 'ok' && okTimer) { clearTimeout(okTimer); okTimer = null; }
        if (action.type === 'ok' && view.longOk) {
            if (e.repeat || okTimer) return;
            okLong = false;
            okTimer = setTimeout(function () { okLong = true; dispatch({ type: 'okLong' }); }, 600);
            return;
        }
        dispatch(action);
    });

    var okTimer = null, okLong = false;
    var hold = { code: 0, start: 0, last: 0 };
    document.addEventListener('keyup', function (e) {
        if (e.keyCode !== 13 || !okTimer) return;
        clearTimeout(okTimer);
        okTimer = null;
        if (!okLong) dispatch({ type: 'ok' });
    });

    function dispatch(action) {
        if (!top()) return;
        var handled = Views[top().name].onKey(action);
        if (!handled && action.type === 'back') back();
    }

    document.addEventListener('visibilitychange', function () {
        var view = top() && Views[top().name];
        if (!view) return;
        if (document.hidden) {
            if (view.onHide) view.onHide();
            Player.stop();
        } else if (view.onShow) {
            view.onShow();
        }
    });

    window.App = { go: go, back: back, replace: replace };

    Log.info('app started on ' + (Platform.isTV ? 'TV' : 'browser') + ', IPTV ' + (Xtream.configured() ? Xtream.server() : 'not set'));
    // First start without a login (none typed in, none from the installer): the welcome screen.
    if (!Xtream.configured() && !Store.get('setupDone', false)) go('welcome');
    else go('home');
})();
