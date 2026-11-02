/* Which provider groups to show: the Live TV countries and the film/series languages chosen in
   Settings (store keys liveCountries / vodLangs). Without a choice, the TV's language decides.
   Everything else stays hidden unless "Other languages and countries" is shown.
   Adult groups are hidden unless unlocked with the PIN. */
(function () {
    'use strict';

    // The first household's choice, before it became a setting. Kept for installs that already
    // have an index built with it, so they are not rebuilt (see Search filterKey).
    var LEGACY_COUNTRIES = ['FR', 'DE', 'UK', 'US', 'ES'];  // in the guide's old order
    var LEGACY_LANGS = ['de', 'es', 'fr', 'en'];

    var COUNTRY_NAMES = {
        FR: 'France', DE: 'Germany', UK: 'United Kingdom', US: 'United States', ES: 'Spain', IT: 'Italy',
        NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', PT: 'Portugal', CA: 'Canada',
        SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', PL: 'Poland', IE: 'Ireland', TR: 'Turkey',
        GR: 'Greece', AR: 'Arabic', AU: 'Australia', BR: 'Brazil', MX: 'Mexico', LA: 'Latin America',
        AFR: 'Africa', ASIA: 'Asia', AL: 'Albania', IL: 'Israel', CZ: 'Czechia', HR: 'Croatia', NZ: 'New Zealand',
        RO: 'Romania', HU: 'Hungary', RU: 'Russia', UA: 'Ukraine', IN: 'India', PK: 'Pakistan', EXYU: 'Ex-Yugoslavia'
    };
    var LANG_NAMES = {
        en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
        pl: 'Polish', tr: 'Turkish', ar: 'Arabic', el: 'Greek', sv: 'Swedish', ro: 'Romanian', ru: 'Russian', hi: 'Hindi'
    };

    // Defaults by the TV's menu language when nothing is chosen yet.
    var BY_LOCALE = {
        fr: [['FR'], ['fr', 'en']], de: [['DE'], ['de', 'en']], es: [['ES'], ['es', 'en']], it: [['IT'], ['it', 'en']],
        pt: [['PT'], ['pt', 'en']], nl: [['NL'], ['nl', 'en']], pl: [['PL'], ['pl', 'en']], tr: [['TR'], ['tr', 'en']]
    };

    // Two-letter prefixes in names like "FR| SPORT" or "EN - ACTION".
    var PREFIX = {
        FR: 'fr', QC: 'fr', DE: 'de', ES: 'es', LA: 'es', EN: 'en', UK: 'en', US: 'en',
        IT: 'it', PT: 'pt', BR: 'pt', NL: 'nl', PL: 'pl', TR: 'tr', AR: 'ar', GR: 'el', SE: 'sv', RO: 'ro',
        RU: 'ru', IN: 'hi'
    };

    // First words of unprefixed group names ("GERMANY NETFLIX", "ESPAÑA SERIES", "HBO MAX SERIES").
    var WORDS = [
        [/^(FRANCE|QU[EÉ]BEC)\b|\(FR\)/, 'fr'],
        [/^(GERMANY|DEUTSCH|JOYN)\b/, 'de'],
        [/^(ESPA[NÑ]A|LATINO)\b/, 'es'],
        [/^(ITALIA|ITALY)\b/, 'it'],
        [/^(PORTUGAL|BRASIL|BRAZIL)\b/, 'pt'],
        [/^(ENGLISH|NETFLIX|DISNEY\+?|APPLE\+?|AMAZON|HBO|PARAMOUNT\+?|PEACOCK|SKY|SHOWTIME|DISCOVERY\+?|NICKELODEON|MARVEL|CRUNCHYROLL|TOP)\b/, 'en'],
        [/^SOCCER\b/, 'any']
    ];

    // "Adult Swim" is a cartoon channel, not adult content.
    function isAdult(name) { return /\b(FOR ADULTS|ADULTS?|XXX|18\+|PORN)\b/i.test(String(name).replace(/ADULT[\s-]*SWIM/ig, '')); }

    function langOf(name) {
        var n = String(name || '').toUpperCase().trim();
        var m = /^([A-Z]{2,4})\s*[-|]/.exec(n);
        if (m) return PREFIX[m[1]] || 'other';
        if (/\b(MENA|ARABIC|HINDI|TURKISH|PERSIAN)\b/.test(n)) return 'other';
        for (var i = 0; i < WORDS.length; i++) if (WORDS[i][0].test(n)) return WORDS[i][1];
        return 'other';
    }

    function allLanguages() { return Store.get('allLanguages', false); }
    // Sample channels show every group, whatever countries and languages are chosen.
    function sample() { return !!(window.Xtream && Xtream.isDemo && Xtream.isDemo()); }

    // A household that used the app before countries became a setting keeps its old choice.
    (function migrate() {
        if (Store.get('liveCountries', null) || Store.get('vodLangs', null)) return;
        var used = Store.get('favs', []).length || Store.get('resume', []).length || Store.get('lastLive', null);
        if (!used) return;
        Store.set('liveCountries', LEGACY_COUNTRIES.slice());
        Store.set('vodLangs', LEGACY_LANGS.slice());
    })();

    function localeDefault() {
        var l = String((navigator.language || 'en')).slice(0, 2).toLowerCase();
        return BY_LOCALE[l] || [['UK', 'US'], ['en']];
    }

    function countries() { return Store.get('liveCountries', null) || localeDefault()[0]; }
    function langs() { return Store.get('vodLangs', null) || localeDefault()[1]; }

    function sameSet(a, b) { return a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0; }); }
    // '' while the choice equals the old built-in one (so existing indexes stay valid).
    function filterSuffix(kind) {
        if (kind === 'live') return sameSet(countries(), LEGACY_COUNTRIES) ? '' : ':' + countries().slice().sort().join(',');
        if (kind === 'movie' || kind === 'series') return sameSet(langs(), LEGACY_LANGS) ? '' : ':' + langs().slice().sort().join(',');
        return '';
    }
    // Unlocked with the PIN; forgotten when the app restarts (e.g. the TV is switched off).
    var adultUnlocked = false;
    function showAdult() { return adultUnlocked; }
    function setAdult(on) { adultUnlocked = !!on; }

    // Movie and series categories.
    function keepCategory(name) {
        if (isAdult(name)) return showAdult();
        if (allLanguages() || sample()) return true;
        var l = langOf(name);
        return l === 'any' || langs().indexOf(l) >= 0;
    }

    // Live TV countries (codes taken from "FR| ..." group names).
    function keepCountry(code) { return allLanguages() || sample() || countries().indexOf(code) >= 0; }

    window.Lang = {
        COUNTRY_NAMES: COUNTRY_NAMES,
        LANG_NAMES: LANG_NAMES,
        countries: countries,
        langs: langs,
        setCountries: function (list) { Store.set('liveCountries', list.slice()); },
        setLangs: function (list) { Store.set('vodLangs', list.slice()); },
        filterSuffix: filterSuffix,
        isAdult: isAdult,
        langOf: langOf,
        keepCategory: keepCategory,
        keepCountry: keepCountry,
        allLanguages: allLanguages,
        showAdult: showAdult,
        setAdult: setAdult,
        PIN: '0000'
    };
})();
