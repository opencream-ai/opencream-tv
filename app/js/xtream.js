/* Xtream Codes API client (the protocol Hot IPTV and most IPTV providers use).
   Providers hand out several server addresses for the same account; when one stops answering
   the client moves on to the next and remembers which one works.
   Server "demo" serves built-in sample data so the app can be tried without a provider. */
(function () {
    'use strict';

    var cache = {};

    function creds() { return Store.get('xtream', null); }

    function normaliseServer(s) {
        s = String(s || '').trim().replace(/\/+$/, '').replace(/\/(player_api|get)\.php.*$/, '');
        if (s && s !== 'demo' && !/^https?:\/\//.test(s)) s = 'http://' + s;
        return s;
    }

    // Accepts one address or several separated by spaces, commas or new lines.
    function parseServers(text) {
        var seen = {};
        return String(text || '').split(/[\s,;]+/).map(normaliseServer).filter(function (s) {
            if (!s || seen[s]) return false;
            seen[s] = true;
            return true;
        });
    }

    function server(c) {
        c = c || creds();
        return c.servers[c.active || 0] || c.servers[0];
    }

    function fetchJson(url, timeoutMs) {
        // The time limit covers the whole download, not just the first byte: a throttled server
        // can answer at once and then trickle a 20 MB list for many minutes (cf.lm24, 31.10.2026).
        // Net.fetchTimeout uses AbortController where present and a timeout race on older TVs.
        return Net.fetchTimeout(url, {}, timeoutMs || 15000).then(function (res) {
            if (!res.ok) throw new Error('Server answered ' + res.status);
            return res.json();
        });
    }

    function query(c, params) {
        var q = 'username=' + encodeURIComponent(c.user) + '&password=' + encodeURIComponent(c.pass);
        Object.keys(params).forEach(function (k) { q += '&' + k + '=' + encodeURIComponent(params[k]); });
        return q;
    }

    // Tries the active server first, then every other one; the first that answers becomes active.
    // After a failover, go back to the first (fastest) server once it has had 5 minutes to recover.
    var switchedAt = 0;

    function request(c, params, timeoutMs) {
        if (server(c) === 'demo') return Promise.resolve(Demo.answer(params));
        if (c.active && switchedAt && Date.now() - switchedAt > 5 * 60e3) {
            c.active = 0;
            switchedAt = 0;
            var s0 = creds();
            if (s0 && s0.user === c.user) { s0.active = 0; Store.set('xtream', s0); }
            Log.info('IPTV trying the first server again: ' + c.servers[0]);
        }
        var order = [];
        for (var i = 0; i < c.servers.length; i++) order.push(((c.active || 0) + i) % c.servers.length);
        var q = query(c, params);
        var attempt = function (n, lastErr) {
            if (n >= order.length) return Promise.reject(lastErr || new Error('No server answered'));
            var idx = order[n];
            return fetchJson(c.servers[idx] + '/player_api.php?' + q, timeoutMs).then(function (data) {
                if (idx !== (c.active || 0)) {
                    c.active = idx;
                    var saved = creds();
                    if (saved && saved.user === c.user) { saved.active = idx; Store.set('xtream', saved); }
                    switchedAt = idx ? Date.now() : 0;
                    Log.info('IPTV server switched to ' + c.servers[idx]);
                }
                return data;
            }, function (e) {
                Log.info('IPTV server failed: ' + c.servers[idx] + ' (' + (e.message || e.name) + ')');
                return attempt(n + 1, e);
            });
        };
        return attempt(0);
    }

    function cached(params) {
        var key = JSON.stringify(params);
        if (!cache[key]) {
            cache[key] = request(creds(), params).catch(function (e) {
                delete cache[key];
                throw e;
            });
        }
        return cache[key];
    }

    function login(c) {
        // Keep the video-only server list: logging in again from Settings used to drop it, and the app
        // then sent video to the Cloudflare servers that only play a "restricted" placeholder (31.10.2026).
        var prev = creds() || {};
        var ss = c.streamServers || prev.streamServers || [];
        c = { servers: c.servers.slice(), streamServers: ss.slice(), active: 0,
            user: String(c.user || '').trim(), pass: String(c.pass || '') };
        return request(c, {}).then(function (info) {
            if (!info || !info.user_info || +info.user_info.auth !== 1) throw new Error('Login refused');
            var formats = info.user_info.allowed_output_formats || [];
            // Raw MPEG-TS has the least overhead on the TV's hardware player; fall back to HLS.
            c.liveExt = formats.indexOf('ts') >= 0 || !formats.length ? 'ts' : 'm3u8';
            Store.set('xtream', c);
            cache = {};
            return info.user_info;
        });
    }

    // Move to the next server (used when a stream fails). Returns the new address.
    function nextServer() {
        var c = creds();
        if (!c || c.servers.length < 2) return null;
        c.active = ((c.active || 0) + 1) % c.servers.length;
        Store.set('xtream', c);
        Log.info('IPTV stream failover to ' + c.servers[c.active]);
        return c.servers[c.active];
    }

    // Provider names carry decorations like "ᴿᴬᵂ ⁶⁰ᶠᵖˢ" and "◉"; keep the readable part.
    function clean(name) {
        return String(name || '')
            .replace(/[ʰ-˿ᴀ-ᶿ⁰-₟ⱼⱽ◉️​-‍]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/^[A-Z0-9][A-Z0-9&+ ]{1,10}:\s+(?=\S)/, '')
            .replace(/[\s\/|\-]+$/, '')
            .trim();
    }

    // "#### AT&T ####" style rows are separators, not channels.
    function isSeparator(s) { return /^[#=*\-_~\s]{2,}/.test(s.name || ''); }

    function list(action, catId) {
        var p = { action: action };
        if (catId != null) p.category_id = catId;
        return cached(p).then(function (r) { return Array.isArray(r) ? r : []; });
    }

    function b64(s) {
        try { return decodeURIComponent(escape(atob(s))); } catch (e) { return s || ''; }
    }

    // Now/next for a live channel: [{ title, start, end }] with times in ms.
    function shortEpg(streamId) {
        return request(creds(), { action: 'get_short_epg', stream_id: streamId, limit: 2 }).then(function (r) {
            return ((r && r.epg_listings) || []).map(function (e) {
                return { title: b64(e.title), start: e.start_timestamp * 1000, end: e.stop_timestamp * 1000 };
            });
        }).catch(function () { return []; });
    }

    function baseOn(srv, kind) {
        var c = creds();
        return srv + '/' + kind + '/' + encodeURIComponent(c.user) + '/' + encodeURIComponent(c.pass) + '/';
    }

    function base(kind) { return baseOn(server(), kind); }

    function isDemo() { return server() === 'demo'; }

    // Streams: hand the provider's URL straight to Samsung's player, which follows the provider's
    // redirect itself. Do NOT probe the URL first: the account allows one connection at a time, so
    // any check (in the app or on another machine) takes that slot and the player is then refused
    // (HTTP 460, "InvalidAccessError"). Tested on the TV 31.10.2026. Which server streams is
    // remembered separately from the one used for listings (some only serve listings).
    // Servers used for video: the configured stream servers, else every server.
    function streamList(c) { return c.streamServers && c.streamServers.length ? c.streamServers : c.servers; }

    function streamIndex(c) {
        var i = Store.get('streamServer', 0);
        return i >= 0 && i < streamList(c).length ? i : 0;
    }

    function resolveStream(kind, item, urlFor) {
        var c = creds();
        if (server(c) === 'demo') return Promise.resolve(Demo.video(item.stream_id || item.id));
        var srv = streamList(c)[streamIndex(c)];
        Log.info('streaming from ' + srv);
        return Promise.resolve(urlFor(srv));
    }

    // Playback failed: use the next server for streams, up to 3 servers. If none of them plays it,
    // the channel itself is down: go back to the first server and return false.
    function nextStreamServer(tried) {
        var c = creds();
        if (!c) return false;
        var list = streamList(c);
        if (tried + 1 >= Math.min(3, list.length)) {
            // Nothing played: back to the first server (best for video). Zapping during a failover
            // used to leave the app stuck on a server that blocks video (31.10.2026).
            Store.set('streamServer', 0);
            return false;
        }
        var i = (streamIndex(c) + 1) % list.length;
        Store.set('streamServer', i);
        Log.info('stream failover to ' + list[i]);
        return true;
    }

    // On every app start go back to the first server in the list (the preferred, fastest one);
    // a failover during an outage would otherwise stick to a slower server for good.
    (function preferFirst() {
        var c = creds();
        if (c && c.active) { c.active = 0; Store.set('xtream', c); }
        Store.set('streamServer', 0);
    })();

    window.Xtream = {
        configured: function () { return !!creds(); },
        isDemo: function () { return !!creds() && isDemo(); },
        creds: creds,
        server: function () { return creds() ? server() : ''; },
        parseServers: parseServers,
        login: login,
        nextServer: nextServer,
        nextStreamServer: nextStreamServer,
        raw: function (params, timeoutMs) { return request(creds(), params, timeoutMs); },
        clean: clean,
        liveCategories: function () { return list('get_live_categories'); },
        liveStreams: function (catId) {
            return list('get_live_streams', catId).then(function (l) { return l.filter(function (s) { return !isSeparator(s); }); });
        },
        vodCategories: function () { return list('get_vod_categories'); },
        vodStreams: function (catId) { return list('get_vod_streams', catId); },
        seriesCategories: function () { return list('get_series_categories'); },
        series: function (catId) { return list('get_series', catId); },
        seriesInfo: function (id) { return cached({ action: 'get_series_info', series_id: id }); },
        vodInfo: function (id) { return cached({ action: 'get_vod_info', vod_id: id }); },
        shortEpg: shortEpg,
        // Each returns a Promise of a direct, playable URL (redirect resolved, abuse servers skipped).
        liveUrl: function (s) {
            return resolveStream('live', s, function (srv) {
                return baseOn(srv, 'live') + s.stream_id + '.' + (creds().liveExt || 'ts');
            });
        },
        movieUrl: function (m) {
            return resolveStream('movie', m, function (srv) {
                return baseOn(srv, 'movie') + m.stream_id + '.' + (m.container_extension || 'mp4');
            });
        },
        episodeUrl: function (ep) {
            return resolveStream('series', ep, function (srv) {
                return baseOn(srv, 'series') + ep.id + '.' + (ep.container_extension || 'mp4');
            });
        }
    };

    // Built-in sample catalogue for trying the interface. Every channel, programme, film and series
    // here is fictional. The video is two openly licensed films from the Blender Foundation
    // (Big Buck Bunny and Tears of Steel, CC BY 3.0), streamed from public test servers. Live
    // channels need clips of several minutes: a 10-second clip ended twice in 15 s, tripped the
    // dead-stream guard and showed "not available" (sample channels, 02.11.2026).
    var Demo = (function () {
        var CLIPS = [
            'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
            'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8'
        ];
        function poster(n) { return 'https://picsum.photos/seed/octv' + n + '/400/600'; }

        // Live groups: code| name, channels, slot length in minutes, programme titles.
        var GROUPS = [
            { id: 1, name: 'UK| News', len: 30,
              chans: ['Northline News', 'Harbour News 24', 'Compass World', 'Capital Report', 'Early Light News', 'Atlas Business', 'Coastline Weather', 'Chamber Live'],
              shows: ['Evening Edition', 'The Late Report', 'Newsdesk', 'Business Hour', 'Weather Outlook', 'Headlines at Ten', 'World at Nine', 'Harbour Lights: Coastal News', 'Market Close', 'Question Hour'] },
            { id: 2, name: 'UK| Sport', len: 90,
              chans: ['Fieldside Sport', 'Fieldside Sport 2', 'Touchline', 'Pitch One', 'Paddock TV', 'Matchday Live', 'Clubhouse Golf', 'Velo Channel'],
              shows: ['Football: Harbour Town v Northgate', 'Cycling: Stage 14 Highlights', 'Racing from Ashcombe', 'Golf: Final Round', 'Tennis: Quarter-finals', 'Rugby Weekly', 'Sailing: Coastal Cup', 'Football Tonight', 'Athletics: Indoor Meeting', 'Snooker: Evening Session'] },
            { id: 3, name: 'UK| Films', len: 120,
              chans: ['Reel One', 'Reel Two', 'Matinee', 'Night Feature', 'Northfield Pictures', 'Lantern Cinema', 'Arthouse Seven', 'Westward Films'],
              shows: ['The Long Coast', 'Paper Harbour', 'Glass River', 'A Winter Field', 'The Last Crossing', 'Lowest Tide', 'Second Summer', 'Salt and Stone', 'The Bay Swimmers', 'Quiet Hours'] },
            { id: 4, name: 'UK| Kids', len: 30,
              chans: ['Kite Kids', 'Little Harbour', 'Paper Boats', 'Puddle TV', 'Bramble Kids', 'Marble Juniors', 'Sunbeam', 'Moonbeam'],
              shows: ['The Lantern Fox', 'Puddle and Sprout', 'Moon Bakery', 'Little Explorers', 'Kite Club', 'Bramble Woods', 'Story Time', 'Paper Boats'] },
            { id: 5, name: 'UK| Documentary', len: 60,
              chans: ['Atelier', 'Wildfield', 'Long View', 'Field Notes', 'Terra Docs', 'Quiet Planet', 'Archive One', 'Starlight'],
              shows: ['Rivers of the North', 'The Quiet Forest', 'Making a Violin', 'Starlight Diaries', 'Wild Coasts', 'Bridges', 'The Salt Road', 'Glass and Fire', 'Island Seasons', 'The Lighthouse Keepers'] },
            { id: 6, name: 'FR| Général', len: 60,
              chans: ['Rive Gauche', 'Ville Lumière', 'Côte Bleue', 'Méridienne', 'Belvédère', 'Côte Ouest', 'Lumière 4', 'Atelier France'],
              shows: ['Le Journal du soir', 'Météo', 'La Grande Table', 'Cuisine de saison', 'Le Magazine', 'Les Rivages', 'Ciné-club', 'Questions du jour'] },
            { id: 7, name: 'DE| Allgemein', len: 60,
              chans: ['Kino Eins', 'Nordlicht', 'Rheinblick', 'Elbe Eins', 'Alpenblick', 'Lindenhof TV', 'Stadtfunk', 'Hafen Zwei'],
              shows: ['Tagesblick', 'Wetter', 'Der Abendfilm', 'Kochen mit Lena', 'Natur im Norden', 'Stadtgespräch', 'Krimi am Abend', 'Sportblick'] }
        ];
        var cats = GROUPS.map(function (g) { return { category_id: g.id, category_name: g.name }; });

        function channels(g) {
            return g.chans.map(function (n, i) {
                return { stream_id: g.id * 100 + i, name: n, category_id: g.id, stream_icon: '', epg_channel_id: 'demo.' + (g.id * 100 + i) };
            });
        }
        function groupOf(streamId) { return GROUPS.filter(function (g) { return g.id === Math.floor(streamId / 100); })[0]; }

        // Programmes of one channel around now: aligned slots, titles rotate per channel.
        function schedule(streamId, count) {
            var g = groupOf(streamId);
            if (!g) return [];
            var len = g.len * 60e3, now = Date.now(), first = Math.floor(now / len) * len - len, out = [];
            var ci = streamId % 100;
            for (var k = 0; k < (count || 8); k++) {
                var s = first + k * len, slot = Math.floor(s / len);
                out.push({ title: g.shows[(ci * 3 + slot) % g.shows.length], start: s, stop: s + len, ch: 'demo.' + streamId });
            }
            return out;
        }

        // Films: [title, category, poster, tmdb, plot, year, genre, duration]
        var FILMS = [
            ['The Long Coast', 10, 0, 9001, 'A family spends one last summer in the house by the sea before it is sold.', '2021', 'Drama', '01:48:00'],
            ['Northern Signal', 10, 1, 9002, 'A radio operator on a remote island starts receiving messages from a ship that sank forty years ago.', '2022', 'Drama', '01:56:00'],
            ['Paper Harbour', 10, 5, 9003, 'Two brothers rebuild their late father\'s boatyard, and each other.', '2020', 'Drama', '01:42:00'],
            ['Quiet Hours', 10, 7, 9004, 'A night nurse and a sleepless widower meet at the same bus stop every morning at five.', '2023', 'Drama', '01:39:00'],
            ['The Orchard', 10, 9, 9005, 'Three generations, one apple harvest and a secret nobody wants to say out loud.', '2019', 'Drama', '02:04:00'],
            ['Salt and Stone', 10, 11, 9006, 'A stonemason returns to her coastal village to restore its crumbling sea wall.', '2024', 'Drama', '01:51:00'],
            ['A Winter Field', 11, 3, 9007, 'An unlikely friendship between a retired farmer and the boy who keeps losing his football over the fence.', '2022', 'Family', '01:34:00'],
            ['The Last Crossing', 11, 21, 9008, 'The last ferry of the season leaves the island with one passenger too many.', '2021', 'Family', '01:29:00'],
            ['Kite Season', 11, 19, 9009, 'A girl and her grandfather build the biggest kite the town has ever seen.', '2023', 'Family', '01:31:00'],
            ['The Lantern Fox', 11, 39, 9010, 'An animated fox carries a lantern through the forest to bring back the morning.', '2024', 'Family', '01:22:00'],
            ['Glass River', 12, 4, 9011, 'A hydrologist finds something in the frozen river that the town would rather keep under the ice.', '2023', 'Thriller', '01:58:00'],
            ['Lowest Tide', 12, 14, 9012, 'When the tide goes out further than ever, a fishing village finds a car on the sea floor.', '2022', 'Thriller', '01:47:00'],
            ['Night Train North', 12, 26, 9013, 'Six strangers, one sleeper carriage and a briefcase nobody claims.', '2021', 'Thriller', '01:44:00'],
            ['The Tower Room', 12, 28, 9014, 'An architect is hired to restore a tower whose top floor appears on no plan.', '2024', 'Thriller', '01:52:00'],
            ['Second Summer', 13, 2, 9015, 'Two retired teachers open a café in the wrong town at the wrong time of year.', '2022', 'Comedy', '01:36:00'],
            ['The Bay Swimmers', 13, 17, 9016, 'A swimming club of six attempts to cross the bay before the council closes their pool.', '2020', 'Comedy', '01:41:00'],
            ['Umbrella Weather', 13, 18, 9017, 'A weather presenter whose forecasts are always wrong gets one week to be right.', '2023', 'Comedy', '01:33:00'],
            ['Uphill All Week', 13, 23, 9018, 'A cycling holiday in the mountains goes exactly as badly as everyone predicted.', '2024', 'Comedy', '01:38:00'],
            ['Rivers of the North', 14, 15, 9019, 'A year following four rivers from their source to the sea.', '2023', 'Documentary', '01:28:00'],
            ['The Lighthouse Keepers', 14, 37, 9020, 'The last people who kept the lights burning, in their own words.', '2022', 'Documentary', '01:17:00'],
            ['Making a Violin', 14, 33, 9021, 'Eight months in a workshop, from a block of spruce to the first note.', '2021', 'Documentary', '01:12:00'],
            ['Wild Coasts', 14, 22, 9022, 'Seals, seabirds and storms along the most remote coastline in Europe.', '2024', 'Documentary', '01:31:00'],
            ['Cloud Line', 14, 24, 9023, 'Glider pilots wait all year for one perfect morning above the clouds.', '2020', 'Documentary', '01:09:00'],
            ['The Orangery', 10, 32, 9025, 'A gardener tends the glasshouse of an empty estate and the letters she finds there.', '2022', 'Drama', '01:46:00'],
            ['Lane Four', 10, 34, 9026, 'A former swimmer coaches her daughter for the race she never finished.', '2023', 'Drama', '01:53:00'],
            ['The Winter Ferry', 10, 36, 9027, 'Ice closes the strait, and one ferry crew decides to make a last crossing.', '2021', 'Drama', '01:49:00'],
            ['Lantern Street', 10, 38, 9028, 'A street of shopkeepers keeps one lamp lit every night for a man who left.', '2024', 'Drama', '01:37:00'],
            ['Field of Larks', 10, 40, 9029, 'A composer goes back to the farm where she grew up to finish her last symphony.', '2020', 'Drama', '01:58:00'],
            ['High Pass', 10, 25, 9024, 'A mountain guide takes one last group over the pass before the snow closes it.', '2023', 'Drama', '01:55:00']
        ];
        // Other versions of the same films (same TMDB id), as providers list them.
        var VERSIONS = [
            ['FR - Le Long Rivage', 15, 0, 9001], ['DE - Die lange Küste', 16, 0, 9001], ['4K-EN - The Long Coast', 17, 0, 9001],
            ['FR - Le Signal du Nord', 15, 1, 9002], ['DE - Das Nordsignal', 16, 1, 9002], ['FR - Rivière de verre', 15, 4, 9011]
        ];
        var VOD_CATS = [[10, 'Drama'], [11, 'Family'], [12, 'Thriller'], [13, 'Comedy'], [14, 'Documentary'],
            [15, 'FR| Films'], [16, 'DE| Filme'], [17, '4K UHD']];

        function filmList(catId) {
            var out = [];
            FILMS.forEach(function (f, i) {
                if (catId == null || f[1] === +catId) out.push({ stream_id: 5000 + i, name: f[0], stream_icon: poster(f[2]), container_extension: 'mp4', tmdb: f[3], category_id: f[1] });
            });
            VERSIONS.forEach(function (v, i) {
                if (catId == null || v[1] === +catId) out.push({ stream_id: 6000 + i, name: v[0], stream_icon: poster(v[2]), container_extension: 'mp4', tmdb: v[3], category_id: v[1] });
            });
            return out;
        }

        // Series: [title, category, poster, plot, genre, year, [season episode titles...]]
        var SERIES = [
            ['Harbour Street', 20, 20, 'Life, love and lobster pots on the busiest street of a small harbour town.', 'Drama', '2022',
                [['Home Port', 'The Auction', 'Fog Bell', 'Spring Tide', 'The Regatta', 'Moorings'], ['Return', 'Dry Dock', 'The Wedding Boat', 'Gale Warning', 'Lights Out']]],
            ['The Mapmakers', 20, 6, 'A family of mapmakers inherits a shop full of maps of places that do not exist.', 'Drama', '2023',
                [['Blank Spaces', 'North Is Up', 'Contour Lines', 'Scale', 'Legend', 'True North']]],
            ['Bramble Woods', 21, 29, 'Animated adventures of the small animals who live under the bramble hedge.', 'Family', '2021',
                [['The Lost Acorn', 'Rain Day', 'Hedgehog Hotel', 'The Big Frost', 'Owl School', 'Moonlight Picnic', 'Snail Race', 'Bonfire Night']]],
            ['Kite Club', 21, 19, 'Five friends, one hill and a lot of string.', 'Family', '2024',
                [['First Flight', 'The Knot', 'Storm Kite', 'Night Kites', 'The Competition']]],
            ['Pier Station', 22, 27, 'Detectives at a seaside police station solve crimes nobody else has noticed.', 'Crime', '2022',
                [['The Pier', 'Low Water', 'The Hotel Guest', 'Shingle', 'Sea Glass', 'The Last Train'], ['High Season', 'Deckchairs', 'The Arcade', 'Undertow']]],
            ['The Old Files', 22, 10, 'A retired inspector reopens the files she could never close.', 'Crime', '2023',
                [['The Lighthouse File', 'Missing Tide', 'The Postcard', 'Second Witness', 'Old Rope', 'Closing Time']]],
            ['Field Kitchen', 23, 12, 'A travelling cook makes one meal a week from whatever the land around her gives.', 'Lifestyle', '2024',
                [['Wild Garlic', 'Mussels', 'Hay-baked Bread', 'Orchard Cider', 'Smoked Trout', 'Chestnuts']]],
            ['Slow Roads', 23, 30, 'Two friends drive the slowest possible route across the continent.', 'Travel', '2022',
                [['The Coast Road', 'Over the Pass', 'Ferry Day', 'Lake Country', 'The Long Straight', 'Home']]],
            ['Below the Arches', 20, 31, 'Stories from the families who live and work beneath the city\'s oldest bridge.', 'Drama', '2021',
                [['Arches', 'Floodwater', 'The Market', 'Lamplighter', 'Footfall']]],
            ['The Lighthouse Year', 20, 13, 'A young keeper and her father spend a year on a rock eleven miles out to sea.', 'Drama', '2023',
                [['Arrival', 'The Lamp', 'First Storm', 'Supply Boat', 'Midwinter', 'Departure']]],
            ['Weatherline', 20, 16, 'Behind the scenes of a small regional weather office in a very wet year.', 'Drama', '2024',
                [['Low Pressure', 'Front', 'The Forecast', 'Heatwave', 'Fog Day', 'Clear Skies']]],
            ['Two Banks', 20, 41, 'Two families farm either side of a river that has moved twice in a century.', 'Drama', '2021',
                [['The Survey', 'High Water', 'Fences', 'The Ford', 'Harvest', 'New Banks'], ['Thaw', 'The Inquiry', 'Bridges', 'Common Ground']]],
            ['Small Hours Ward', 22, 8, 'One night in a city hospital, told in real time across eight episodes.', 'Crime', '2024',
                [['22:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00']]]
        ];
        var SERIES_CATS = [[20, 'Drama'], [21, 'Family'], [22, 'Crime'], [23, 'Lifestyle & Travel']];

        function answer(p) {
            switch (p.action) {
                case undefined: return { user_info: { auth: 1, allowed_output_formats: ['ts'] } };
                case 'get_live_categories': return cats;
                case 'get_live_streams':
                    var gs = p.category_id == null ? GROUPS : GROUPS.filter(function (g) { return g.id === +p.category_id; });
                    return [].concat.apply([], gs.map(channels));
                case 'get_short_epg':
                    return { epg_listings: schedule(+p.stream_id, 4).filter(function (e) { return e.stop > Date.now(); }).slice(0, 2).map(function (e) {
                        return { title: btoa(unescape(encodeURIComponent(e.title))), start_timestamp: e.start / 1000, stop_timestamp: e.stop / 1000 };
                    }) };
                case 'get_vod_categories': return VOD_CATS.map(function (c) { return { category_id: c[0], category_name: c[1] }; });
                case 'get_series_categories': return SERIES_CATS.map(function (c) { return { category_id: c[0], category_name: c[1] }; });
                case 'get_vod_streams': return filmList(p.category_id);
                case 'get_vod_info':
                    var f = FILMS[+p.vod_id - 5000] || FILMS[(VERSIONS[+p.vod_id - 6000] || [0, 0, 0, 9001])[3] - 9001];
                    return { info: { plot: f[4], releasedate: f[5], genre: f[6], duration: f[7] } };
                case 'get_series':
                    var out = [];
                    SERIES.forEach(function (s, i) {
                        if (p.category_id == null || s[1] === +p.category_id) out.push({ series_id: 8000 + i, name: s[0], cover: poster(s[2]) });
                    });
                    return out;
                case 'get_series_info':
                    var s = SERIES[+p.series_id - 8000] || SERIES[0], eps = {};
                    s[6].forEach(function (titles, si) {
                        eps[si + 1] = titles.map(function (t, n) {
                            return { id: (+p.series_id) * 100 + si * 20 + n, episode_num: n + 1, title: t, container_extension: 'mp4', info: { duration: '00:' + (42 + (n * 7) % 14) + ':00' } };
                        });
                    });
                    return { info: { name: s[0], plot: s[3], genre: s[4], releaseDate: s[5] }, episodes: eps };
            }
            return [];
        }

        return {
            answer: answer,
            video: function (id) { return CLIPS[(Math.floor(id / 100) + id) % CLIPS.length]; }
        };
    })();
})();
