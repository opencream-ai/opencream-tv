/* Small UI helpers: escaping, time formatting, toast, and windowed lists/grids
   that only keep the visible rows in the DOM (IPTV categories can hold thousands of entries). */
(function () {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function clock(d) {
        d = d || new Date();
        var h = d.getHours(), m = pad(d.getMinutes());
        if (Store.get('clock12', false)) {
            var ap = h < 12 ? 'AM' : 'PM', h12 = h % 12 || 12;
            return h12 + ':' + m + ' ' + ap;
        }
        return pad(h) + ':' + m;
    }

    function duration(ms) {
        var s = Math.max(0, Math.floor(ms / 1000));
        var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
        return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60);
    }

    var toastTimer;
    function toast(msg) {
        var el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3000);
    }

    // Vertical list. renderRow(item, i) returns the inner HTML of one row.
    function VList(el, opts) {
        this.el = el;
        this.rowH = opts.rowH;
        this.renderRow = opts.renderRow;
        this.items = [];
        this.index = 0;
        this.first = -1;
        this.active = false;
    }

    VList.prototype.set = function (items, index) {
        this.items = items || [];
        this.index = Math.max(0, Math.min(index || 0, this.items.length - 1));
        this.first = -1;
        this.render();
    };

    VList.prototype.visibleRows = function () {
        return Math.max(1, Math.floor(this.el.clientHeight / this.rowH));
    };

    VList.prototype.move = function (delta) {
        var next = Math.max(0, Math.min(this.index + delta, this.items.length - 1));
        if (next === this.index) return false;
        this.index = next;
        this.render();
        return true;
    };

    VList.prototype.current = function () { return this.items[this.index]; };

    // Rows to move for one Up/Down while the key is held: one at first, then half a page, then a page.
    function holdStep(heldMs, page) {
        page = Math.max(1, page || 1);
        if (!heldMs || heldMs < 800) return 1;
        if (heldMs < 2000) return Math.max(1, Math.floor(page / 2));
        return page;
    }

    VList.prototype.setActive = function (on) {
        this.active = on;
        this.el.classList.toggle('active', on);
    };

    VList.prototype.render = function () {
        var rows = this.visibleRows();
        var first = this.first < 0 ? 0 : this.first;
        // Keep one row of context above and below the focus while scrolling.
        if (this.index < first + 1) first = this.index - 1;
        if (this.index > first + rows - 2) first = this.index - rows + 2;
        first = Math.max(0, Math.min(first, this.items.length - rows));
        first = Math.max(0, first);

        if (first !== this.first) {
            this.first = first;
            var html = '';
            for (var i = first; i < Math.min(this.items.length, first + rows + 1); i++) {
                html += '<div class="row" data-i="' + i + '" style="transform:translateY(' + (i - first) * this.rowH + 'px)">' +
                    this.renderRow(this.items[i], i) + '</div>';
            }
            this.el.innerHTML = html;
        }
        var self = this;
        Array.prototype.forEach.call(this.el.children, function (row) {
            row.classList.toggle('focus', +row.getAttribute('data-i') === self.index);
        });
    };

    // Poster grid with a fixed number of columns, windowed by rows.
    function VGrid(el, opts) {
        this.el = el;
        this.cols = opts.cols;
        this.rowH = opts.rowH;
        this.colW = opts.colW;
        this.renderCell = opts.renderCell;
        this.items = [];
        this.index = 0;
        this.firstRow = -1;
    }

    VGrid.prototype.set = function (items, index) {
        this.items = items || [];
        this.index = Math.max(0, Math.min(index || 0, this.items.length - 1));
        this.firstRow = -1;
        this.render();
    };

    VGrid.prototype.current = function () { return this.items[this.index]; };

    // Returns false when the move would leave the grid (so the caller can move focus elsewhere).
    VGrid.prototype.move = function (dx, dy) {
        var col = this.index % this.cols;
        if (dx < 0 && col === 0) return false;
        if (dx > 0 && (col === this.cols - 1 || this.index === this.items.length - 1)) return false;
        var next = this.index + dx + dy * this.cols;
        if (dy > 0 && next >= this.items.length) {
            // Moving down onto a shorter last row: land on its last item.
            if (Math.floor(this.index / this.cols) === Math.floor((this.items.length - 1) / this.cols)) return false;
            next = this.items.length - 1;
        }
        if (next < 0 || next >= this.items.length) return false;
        this.index = next;
        this.render();
        return true;
    };

    VGrid.prototype.setActive = function (on) { this.el.classList.toggle('active', on); };

    VGrid.prototype.render = function () {
        var rows = Math.max(1, Math.floor(this.el.clientHeight / this.rowH));
        var row = Math.floor(this.index / this.cols);
        var first = this.firstRow < 0 ? 0 : this.firstRow;
        if (row < first) first = row;
        if (row > first + rows - 1) first = row - rows + 1;

        if (first !== this.firstRow) {
            this.firstRow = first;
            var html = '';
            var start = first * this.cols;
            var end = Math.min(this.items.length, (first + rows + 1) * this.cols);
            for (var i = start; i < end; i++) {
                var r = Math.floor(i / this.cols) - first, c = i % this.cols;
                html += '<div class="cell" data-i="' + i + '" style="transform:translate(' + c * this.colW + 'px,' + r * this.rowH + 'px)">' +
                    this.renderCell(this.items[i], i) + '</div>';
            }
            this.el.innerHTML = html;
        }
        var self = this;
        Array.prototype.forEach.call(this.el.children, function (cell) {
            cell.classList.toggle('focus', +cell.getAttribute('data-i') === self.index);
        });
    };

    window.UI = {
        esc: esc,
        clock: clock,
        duration: duration,
        toast: toast,
        VList: VList,
        holdStep: holdStep,
        VGrid: VGrid
    };
})();
