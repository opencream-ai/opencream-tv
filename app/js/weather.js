/* Local weather for the home screen: one symbol and the temperature (Settings -> Weather).
   Location: the town typed in Settings (Open-Meteo geocoding, kept until changed), or, only if the
   user asks for it, the internet address (ip-api.com, cached for a week). Weather: Open-Meteo
   (free, no key), refreshed every 30 minutes and cached so the home screen shows it at once. */
(function () {
    'use strict';

    var WEATHER_TTL = 30 * 60e3, PLACE_TTL = 7 * 24 * 3600e3;
    var loading = null, listeners = [];

    function enabled() { return Store.get('weather', true) !== false; }

    // Installs that already used the automatic location keep it (before the town setting existed).
    (function migrate() {
        if (Store.get('weatherAuto', null) !== null) return;
        var p = Store.get('weatherPlace', null);
        if (p && !p.manual) Store.set('weatherAuto', true);
    })();

    function auto() { return Store.get('weatherAuto', false) === true; }

    function place() {
        var p = Store.get('weatherPlace', null);
        if (p && (p.manual || Date.now() - p.at < PLACE_TTL)) return Promise.resolve(p);
        if (!auto()) return Promise.reject(new Error('no town chosen'));
        return fetch('http://ip-api.com/json/?fields=status,city,lat,lon', { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j.status !== 'success') throw new Error('location unknown');
                p = { city: j.city, lat: j.lat, lon: j.lon, at: Date.now() };
                Store.set('weatherPlace', p);
                return p;
            });
    }

    // WMO weather code -> icon (day/night variants where it matters).
    function iconFor(code, day) {
        if (code === 0) return day ? 'w_sun' : 'w_moon';
        if (code <= 2) return day ? 'w_cloud_sun' : 'w_cloud_moon';
        if (code === 3) return 'w_cloud';
        if (code === 45 || code === 48) return 'w_cloud_fog';
        if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'w_cloud_snow';
        if (code >= 95) return 'w_cloud_lightning';
        return 'w_cloud_rain';  // drizzle, rain, showers
    }

    function refresh() {
        if (loading) return loading;
        loading = place().then(function (p) {
            return fetch('https://api.open-meteo.com/v1/forecast?latitude=' + p.lat + '&longitude=' + p.lon +
                '&current=temperature_2m,weather_code,is_day&timezone=auto', { cache: 'no-store' })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    var c = j.current;
                    var w = { temp: Math.round(c.temperature_2m), icon: iconFor(c.weather_code, c.is_day === 1), city: p.city, at: Date.now() };
                    Store.set('weatherNow', w);
                    listeners.forEach(function (fn) { fn(w); });
                    return w;
                });
        }).catch(function (e) {
            if (!(e && e.message === 'no town chosen')) Log.info('weather failed: ' + (e && e.message));
            return null;
        }).then(function (w) { loading = null; return w; });
        return loading;
    }

    // Last known weather (may be old), and a refresh if it is due.
    function current() {
        var w = Store.get('weatherNow', null);
        if (enabled() && (!w || Date.now() - w.at > WEATHER_TTL)) refresh();
        return w && Date.now() - w.at < 6 * 3600e3 ? w : null;
    }

    // Look a town up by name; the first match becomes the weather place. Resolves to the place.
    function setTown(name) {
        name = String(name || '').trim();
        if (!name) return Promise.reject(new Error('no town'));
        return fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&format=json&name=' + encodeURIComponent(name), { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var g = j.results && j.results[0];
                if (!g) throw new Error('town not found');
                var p = { city: g.name, country: g.country || '', lat: g.latitude, lon: g.longitude, at: Date.now(), manual: true };
                Store.set('weatherPlace', p);
                Store.set('weatherAuto', false);
                Store.set('weatherNow', null);
                return refresh().then(function () { return p; });
            });
    }

    // Opt-in: find the town from the TV's internet address (sends it to ip-api.com).
    function useAuto() {
        Store.set('weatherAuto', true);
        Store.set('weatherPlace', null);
        Store.set('weatherNow', null);
        return refresh();
    }

    window.Weather = {
        setTown: setTown,
        useAuto: useAuto,
        auto: auto,
        enabled: enabled,
        current: current,
        refresh: refresh,
        onChange: function (fn) { listeners = [fn]; },
        place: function () { var p = Store.get('weatherPlace', null); return p ? p.city : ''; }
    };
})();
