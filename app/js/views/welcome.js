/* Welcome: first start without an IPTV login. Two steps, both skippable: the IPTV login, then the
   apps for the dock. Shown once; everything here can be changed later in Settings. */
(function () {
    'use strict';

    window.Views = window.Views || {};

    var el, step, rows, idx, apps, ticked;

    function iptvRows() {
        return [
            { kind: 'field', key: 'server', label: 'Server address', type: 'text' },
            { kind: 'field', key: 'user', label: 'Username', type: 'text' },
            { kind: 'field', key: 'pass', label: 'Password', type: 'password' },
            { kind: 'button', key: 'connect', label: 'Connect' },
            { kind: 'button', key: 'demo', label: 'Try with sample channels' },
            { kind: 'button', key: 'skip', label: 'Skip, I will do this later in Settings' }
        ];
    }

    function appRows() {
        return apps.map(function (a, i) { return { kind: 'app', i: i, app: a }; })
            .concat([{ kind: 'button', key: 'done', label: 'Done' }]);
    }

    function head(title, hint) {
        return '<header class="set-head"><p class="brand">opencream TV</p><h1>' + title + '</h1></header>' +
            '<div class="set-body"><p class="hint">' + hint + '</p>';
    }

    function render() {
        var html;
        if (step === 'iptv') {
            html = head('Add your IPTV service',
                'Enter the Xtream Codes login from your IPTV provider. Several server addresses can be separated by commas. ' +
                'opencream TV comes with no channels: it plays the service you already subscribe to. M3U playlists are coming in a later version.');
        } else {
            html = head('Choose your apps',
                'These apps are installed on this TV. OK adds or removes one from the home screen. ' +
                'You can reorder them any time in Settings, Apps in the dock.');
        }
        rows.forEach(function (r, i) {
            var cls = 'srow' + (i === idx ? ' focus' : '');
            if (r.kind === 'field') {
                html += '<label class="' + cls + '"><span class="lbl">' + r.label + '</span>' +
                    '<input data-key="' + r.key + '" type="' + r.type + '" value="" autocomplete="off" spellcheck="false"></label>';
            } else if (r.kind === 'app') {
                html += '<div class="' + cls + '"><span class="lbl app"><span class="sicon i-' + (r.app.icon || 'tvapp') + '">' +
                    Apps.iconHtml(r.app) + '</span>' + UI.esc(r.app.label) + '</span><span class="val">' +
                    (ticked[r.app.id] ? 'On the dock' : '') + '</span></div>';
            } else {
                html += '<div class="' + cls + ' sbtn"><span>' + r.label + '</span></div>';
            }
        });
        var typed = {};
        if (el) Array.prototype.forEach.call(el.querySelectorAll('input'), function (n) { typed[n.getAttribute('data-key')] = n.value; });
        el.innerHTML = html + '</div>';
        Object.keys(typed).forEach(function (k) {
            var n = el.querySelector('input[data-key="' + k + '"]');
            if (n) n.value = typed[k];
        });
        keepVisible();
    }

    function keepVisible() {
        var f = el.querySelector('.srow.focus');
        if (!f) return;
        var top = f.offsetTop, bottom = top + f.offsetHeight, margin = 160;
        if (idx === 0) el.scrollTop = 0;
        else if (bottom + margin > el.scrollTop + el.clientHeight) el.scrollTop = bottom + margin - el.clientHeight;
        else if (top - margin < el.scrollTop) el.scrollTop = Math.max(0, top - margin);
    }

    function value(key) {
        var n = el.querySelector('input[data-key="' + key + '"]');
        return n ? n.value : '';
    }

    function connect(c) {
        UI.toast('Connecting...');
        Xtream.login(c).then(function () {
            UI.toast('Connected');
            toApps();
        }).catch(function (e) { UI.toast('Could not connect: ' + e.message); });
    }

    function toApps() {
        step = 'apps';
        rows = [{ kind: 'button', key: 'done', label: 'Done' }];
        idx = 0;
        render();
        Apps.installed().then(function (list) {
            apps = list.length ? list : Apps.knownList();
            // Pre-tick what is on the dock now (YouTube, Netflix, Prime Video on a new TV) if installed.
            ticked = {};
            var current = Apps.dock();
            apps.forEach(function (a) {
                if (current.some(function (d) { return d.id === a.id || d.label === a.label; })) ticked[a.id] = true;
            });
            rows = appRows();
            render();
        });
    }

    function finish() {
        if (apps && apps.length) {
            var keep = Apps.dock().filter(function (d) {
                return apps.some(function (a) { return ticked[a.id] && (a.id === d.id || a.label === d.label); });
            });
            var chosen = keep.slice();
            apps.forEach(function (a) {
                if (ticked[a.id] && !chosen.some(function (d) { return d.id === a.id || d.label === a.label; })) {
                    chosen.push({ id: a.id, label: a.label, icon: a.icon, iconPath: a.iconPath });
                }
            });
            Store.set('dockApps', chosen);
        }
        Store.set('setupDone', true);
        App.replace('home');
    }

    window.Views.welcome = {
        mount: function (root, params) {
            el = document.createElement('div');
            el.className = 'settings welcome';
            root.appendChild(el);
            apps = [];
            ticked = {};
            if (params && params.step === 'apps') { toApps(); return; }
            step = 'iptv';
            rows = iptvRows();
            idx = 0;
            render();
        },
        unmount: function () { el = null; },
        onKey: function (a) {
            var r = rows[idx];
            switch (a.type) {
                case 'up': if (idx > 0) idx--; break;
                case 'down': if (idx < rows.length - 1) idx++; break;
                case 'ok':
                    if (r.kind === 'field') { el.querySelector('input[data-key="' + r.key + '"]').focus(); return true; }
                    if (r.key === 'connect') {
                        var servers = Xtream.parseServers(value('server'));
                        if (!servers.length || !value('user')) { UI.toast('Enter the server address and username first'); return true; }
                        connect({ servers: servers, user: value('user'), pass: value('pass') });
                        return true;
                    }
                    if (r.key === 'demo') { connect({ servers: ['demo'], user: 'demo', pass: 'demo' }); return true; }
                    if (r.key === 'skip') { toApps(); return true; }
                    if (r.kind === 'app') { ticked[r.app.id] = !ticked[r.app.id]; break; }
                    if (r.key === 'done') { finish(); return true; }
                    return true;
                case 'back':
                    if (step === 'apps') { step = 'iptv'; rows = iptvRows(); idx = 0; break; }
                    return true; // the first screen is the bottom of the stack
                default: return true;
            }
            render();
            return true;
        }
    };
})();
