/* One video engine for the whole app.
   On the TV: Samsung AVPlay (hardware decoding, plays raw MPEG-TS live streams and MKV).
   In a desktop browser: a plain <video> element, for previewing the interface. */
(function () {
    'use strict';

    var handlers = {};
    var useAvplay = typeof window.webapis !== 'undefined' && !!webapis.avplay;
    var video = document.getElementById('html5video');
    var paused = false;
    var token = 0;

    // The <video> fallback is only for desktop preview; on the TV it would cover the video plane.
    document.body.classList.toggle('html5', !useAvplay);

    function safe(url) { return String(url).replace(/\/\/([^/]+)\/(live|movie|series)\/[^/]+\/[^/]+\//, '//$1/$2/***/'); }

    function emit(name, arg) { if (handlers[name]) handlers[name](arg); }

    function on(h) { handlers = h || {}; }

    function avState() {
        try { return webapis.avplay.getState(); } catch (e) { return 'NONE'; }
    }

    function stop() {
        token++;
        paused = false;
        document.body.classList.remove('video');
        if (useAvplay) {
            var st = avState();
            try { if (st === 'PLAYING' || st === 'PAUSED' || st === 'READY') webapis.avplay.stop(); } catch (e) { /* already stopped */ }
            try { if (st !== 'NONE') webapis.avplay.close(); } catch (e) { /* already closed */ }
        } else {
            video.pause();
            video.removeAttribute('src');
            video.load();
        }
    }

    // opts.startMs: resume position for movies/episodes.
    function play(url, opts) {
        opts = opts || {};
        stop();
        var mine = token, t0 = Date.now(), seen = false;
        document.body.classList.add('video');
        emit('buffering', true);
        Log.info('play ' + (useAvplay ? 'avplay ' : 'html5 ') + safe(url));

        if (useAvplay) {
            try {
                webapis.avplay.open(url);
                webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
                webapis.avplay.setListener({
                    onbufferingstart: function () { emit('buffering', true); },
                    onbufferingcomplete: function () { emit('buffering', false); },
                    oncurrentplaytime: function (ms) {
                        if (!seen && ms > 0 && mine === token) { seen = true; Log.info('playing after ' + (Date.now() - t0) + 'ms'); }
                        emit('time', ms);
                    },
                    onstreamcompleted: function () { emit('ended'); },
                    onerror: function (err) { Log.error('avplay error ' + err); emit('error', err); },
                    onsubtitlechange: function (duration, text) { if (mine === token) emit('subtitle', { text: text, ms: +duration || 0 }); },
                    onevent: function (type, data) { Log.info('avplay event ' + type + ' ' + (data || '')); }
                });
                webapis.avplay.prepareAsync(function () {
                    if (mine !== token) return;
                    var go = function () { if (mine === token) { webapis.avplay.play(); emit('buffering', false); emit('ready'); } };
                    if (opts.startMs) webapis.avplay.seekTo(opts.startMs, go, go); else go();
                }, function (err) {
                    Log.error('avplay prepare failed: ' + (err && (err.name || err.message) || err));
                    if (mine === token) emit('error', err);
                });
            } catch (e) {
                Log.error('avplay open failed: ' + (e.name || '') + ' ' + (e.message || e));
                emit('error', e);
            }
            return;
        }

        video.src = url;
        video.onplaying = function () { emit('buffering', false); };
        video.onwaiting = function () { emit('buffering', true); };
        video.ontimeupdate = function () { emit('time', video.currentTime * 1000); };
        video.onended = function () { emit('ended'); };
        video.onerror = function () { emit('error', video.error); };
        video.onloadedmetadata = function () {
            if (opts.startMs) video.currentTime = opts.startMs / 1000;
            emit('ready');
        };
        video.play().catch(function () { /* autoplay blocked in a browser tab: press OK */ });
    }

    function toggle() {
        paused = !paused;
        if (useAvplay) {
            try { if (paused) webapis.avplay.pause(); else webapis.avplay.play(); } catch (e) { /* not playing */ }
        } else if (paused) {
            video.pause();
        } else {
            video.play();
        }
        return paused;
    }

    function time() {
        if (useAvplay) { try { return webapis.avplay.getCurrentTime(); } catch (e) { return 0; } }
        return video.currentTime * 1000;
    }

    function duration() {
        if (useAvplay) { try { return webapis.avplay.getDuration(); } catch (e) { return 0; } }
        return isFinite(video.duration) ? video.duration * 1000 : 0;
    }

    function seek(deltaMs) {
        var target = Math.max(0, Math.min(time() + deltaMs, Math.max(0, duration() - 2000)));
        if (useAvplay) {
            try { webapis.avplay.seekTo(target); } catch (e) { /* seeking not supported on this stream */ }
        } else {
            video.currentTime = target / 1000;
        }
        return target;
    }

    // ---------- audio and subtitle tracks (AVPlay only) ----------

    function parseExtra(t) {
        try { return JSON.parse(t.extra_info || '{}'); } catch (e) { return {}; }
    }

    // { audio: [{index, lang, channels, codec, current}], text: [{index, lang, current}] }
    function tracks() {
        var out = { audio: [], text: [] };
        if (!useAvplay) return out;
        var all, cur = {};
        try { all = webapis.avplay.getTotalTrackInfo(); } catch (e) { return out; }
        try {
            (webapis.avplay.getCurrentStreamInfo() || []).forEach(function (c) { cur[c.type] = +c.index; });
        } catch (e) { /* not available in this state */ }
        for (var i = 0; i < all.length; i++) {
            var t = all[i], x = parseExtra(t);
            if (t.type === 'AUDIO') {
                out.audio.push({ index: +t.index, lang: x.language || x.lang || '', channels: +x.channels || 0,
                    codec: String(x.fourCC || x.codec || ''), current: cur.AUDIO === +t.index });
            } else if (t.type === 'TEXT') {
                out.text.push({ index: +t.index, lang: x.track_lang || x.language || '', current: false });
            }
        }
        return out;
    }

    function selectAudio(index) {
        try { webapis.avplay.setSelectTrack('AUDIO', index); return true; } catch (e) { Log.error('audio track ' + index + ': ' + e.message); return false; }
    }

    // index < 0 turns subtitles off.
    function selectText(index) {
        if (!useAvplay) return false;
        try {
            if (index < 0) { webapis.avplay.setSilentSubtitle(true); emit('subtitle', { text: '', ms: 0 }); return true; }
            webapis.avplay.setSelectTrack('TEXT', index);
            webapis.avplay.setSilentSubtitle(false);
            return true;
        } catch (e) { Log.error('subtitle track ' + index + ': ' + e.message); return false; }
    }

    window.Player = {
        tracks: tracks,
        selectAudio: selectAudio,
        selectText: selectText,
        on: on,
        play: play,
        stop: stop,
        toggle: toggle,
        seek: seek,
        time: time,
        duration: duration,
        isPaused: function () { return paused; }
    };
})();
