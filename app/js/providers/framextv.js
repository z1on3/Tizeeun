// frameXTV provider: a built-in online stream aggregator (no login, no config).
//
// For a TMDB id it queries frameXTV's extraction catalog. Each extraction
// provider (Super Barbarian, Bowler, Miner, …) is one "source" in the
// aggregator; within it there are several HLS mirrors the player can fail over
// between. Streams are .m3u8 — the player plays them with hls.js (see
// player.js). Unlike the media-server providers, frameXTV.findSource() resolves
// to an ARRAY of mirrors (or [] when the provider doesn't have the title).
var FrameXtvProvider = (function () {
  var API = 'https://api.framextv.tech';
  var PROVIDERS_CACHE = null; // /api/providers rarely changes; cache in memory.

  function request(path) {
    return fetch(API + path, { headers: { Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('frameXTV ' + res.status);
      return res.json();
    });
  }

  // The extraction servers frameXTV currently offers. Cached after first fetch.
  function listProviders() {
    if (PROVIDERS_CACHE) return Promise.resolve(PROVIDERS_CACHE);
    return request('/api/providers').then(function (meta) {
      var provs = ((meta && meta.providers) || [])
        .filter(function (p) { return p.status === 'available'; })
        .map(function (p) { return { id: p.id, name: p.name, tagline: p.tagline || '', category: p.category || 'movie_tv' }; });
      if (provs.length) PROVIDERS_CACHE = provs;
      return provs;
    }).catch(function (err) {
      console.warn('[framextv] providers: ' + err.message);
      return [];
    });
  }

  // Normalize a /api/stream response into shared source objects. Returns [].
  function normalize(json, item) {
    if (!json || !json.success || !json.sources) return [];
    var fallback = json.provider || 'frameXTV';
    return json.sources.map(function (s) {
      return {
        url: s.url,
        title: item.title,
        note: (s.quality || 'HLS') + '  ·  ' + (s.server || fallback),
        startSeconds: 0,
        type: s.type || 'hls',
        quality: s.quality || '',
        providerName: fallback,
        serverName: s.server || fallback,
        audioTracks: s.audioTracks || []
      };
    });
  }

  function streamPath(item, providerId) {
    var type = item.type === 'tv' ? 'tv' : 'movie';
    var path = '/api/stream?type=' + type + '&id=' + item.tmdbId;
    if (type === 'tv') path += '&season=' + (item.season || 1) + '&episode=' + (item.episode || 1);
    if (providerId) path += '&provider=' + providerId;
    return path;
  }

  // All HLS mirrors for one extraction provider (server.id). [] if unavailable.
  function findSource(server, item) {
    if (!item || !item.tmdbId) return Promise.resolve([]);
    return request(streamPath(item, server && server.id))
      .then(function (json) { return normalize(json, item); })
      .catch(function (err) {
        console.warn('[framextv] stream: ' + err.message);
        return [];
      });
  }

  return {
    type: 'framextv',
    label: 'frameXTV',
    builtIn: true, // always-on online aggregator: no fields, no connect
    fields: [],
    connect: function () {
      return Promise.resolve({ type: 'framextv', name: 'frameXTV', url: 'https://framextv.xyz', token: '' });
    },
    libraryRows: function () { return []; },
    sourceForLocal: function () { return Promise.resolve(null); },
    findSource: findSource,
    listProviders: listProviders
  };
})();
