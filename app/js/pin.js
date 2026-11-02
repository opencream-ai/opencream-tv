/* Four-digit PIN prompt. Digits from the remote's number pad, or Up/Down to change a digit
   and Left/Right to move (for remotes without number keys). */
(function () {
    'use strict';

    var box = null, digits, pos, done;

    function paint() {
        box.querySelector('.pins').innerHTML = digits.map(function (d, i) {
            return '<span class="pd' + (i === pos ? ' focus' : '') + (d != null ? ' set' : '') + '">' + (d != null ? '•' : '') + '</span>';
        }).join('');
    }

    function close(ok) {
        box.remove();
        box = null;
        done(ok);
    }

    function check() {
        close(digits.join('') === Lang.PIN);
    }

    function ask(cb) {
        done = cb;
        digits = [null, null, null, null];
        pos = 0;
        box = document.createElement('div');
        box.className = 'pin';
        box.innerHTML = '<div class="pinbox glass"><div class="ptitle2">Enter PIN</div><div class="pins"></div>' +
            '<div class="phint">Number keys, or Up/Down to choose a digit, then OK</div></div>';
        document.body.appendChild(box);
        paint();
    }

    function onKey(a) {
        switch (a.type) {
            case 'digit':
                digits[pos] = a.n;
                if (pos === 3) { check(); return true; }
                pos++;
                break;
            case 'up': digits[pos] = ((digits[pos] == null ? -1 : digits[pos]) + 1) % 10; break;
            case 'down': digits[pos] = ((digits[pos] == null ? 10 : digits[pos]) + 9) % 10; break;
            case 'left': if (pos > 0) pos--; break;
            case 'right': if (pos < 3) pos++; break;
            case 'ok':
                if (digits.every(function (d) { return d != null; })) { check(); return true; }
                if (digits[pos] != null && pos < 3) pos++;
                break;
            case 'back': close(false); return true;
        }
        paint();
        return true;
    }

    window.Pin = { ask: ask, onKey: onKey, isOpen: function () { return !!box; } };
})();
