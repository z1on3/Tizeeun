// TMDB client using the key built into config.js.
// Accepts either a v3 API key (32 hex chars) or a v4 read access token.
var TMDB = (function () {
  var BASE = Config.tmdbBase;
  var IMG = 'https://image.tmdb.org/t/p/';
  // A custom base is a proxy that adds the key itself, so no key is needed here.
  var PROXIED = BASE !== 'https://api.themoviedb.org/3';
  var CONFIGURED = !!Config.tmdbKey || PROXIED;
  var cache = {};

  function isV4Token(key) {
    return key.length > 40;
  }

  function get(path, params) {
    var key = Config.tmdbKey;
    if (!CONFIGURED) return Promise.reject(new Error('catalog not configured'));

    var query = Object.assign({ language: 'en-US' }, params || {});
    var headers = { Accept: 'application/json' };
    if (key && isV4Token(key)) headers.Authorization = 'Bearer ' + key;
    else if (key) query.api_key = key;

    var qs = Object.keys(query).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]);
    }).join('&');
    var url = BASE + path + '?' + qs;

    if (cache[url]) return Promise.resolve(cache[url]);
    return fetch(url, { headers: headers }).then(function (res) {
      if (!res.ok) throw new Error('TMDB ' + res.status);
      return res.json();
    }).then(function (json) {
      cache[url] = json;
      return json;
    });
  }

  // Normalize movie/tv results into one shape the UI understands.
  function normalize(item, fallbackType) {
    var type = item.media_type || fallbackType;
    var date = item.release_date || item.first_air_date || '';
    return {
      tmdbId: item.id,
      type: type === 'tv' ? 'tv' : 'movie',
      title: item.title || item.name || 'Untitled',
      year: date ? date.slice(0, 4) : '',
      overview: item.overview || '',
      rating: item.vote_average ? item.vote_average.toFixed(1) : '',
      poster: item.poster_path ? IMG + 'w342' + item.poster_path : '',
      backdrop: item.backdrop_path ? IMG + 'w1280' + item.backdrop_path : ''
    };
  }

  function list(path, type, params) {
    return get(path, params).then(function (json) {
      return (json.results || [])
        .filter(function (r) { return r.media_type !== 'person'; })
        .map(function (r) { return normalize(r, type); });
    });
  }

  return {
    rows: function () {
      return [
        { title: 'Trending this week', load: function () { return list('/trending/all/week'); } },
        { title: 'Popular movies', load: function () { return list('/movie/popular', 'movie'); } },
        { title: 'Popular series', load: function () { return list('/tv/popular', 'tv'); } },
        { title: 'Top rated movies', load: function () { return list('/movie/top_rated', 'movie'); } },
        { title: 'Now playing', load: function () { return list('/movie/now_playing', 'movie'); } }
      ];
    },
    genres: function (type) {
      return get('/genre/' + type + '/list').then(function (json) { return json.genres || []; });
    },
    // Filtered catalog for Browse. sort: 'popular' | 'top' | 'newest'.
    discover: function (type, opts) {
      var dateField = type === 'tv' ? 'first_air_date' : 'primary_release_date';
      var params = { include_adult: 'false', sort_by: 'popularity.desc' };
      if (opts.genreId) params.with_genres = opts.genreId;
      if (opts.sort === 'top') {
        params.sort_by = 'vote_average.desc';
        params['vote_count.gte'] = 300;
      } else if (opts.sort === 'newest') {
        params.sort_by = dateField + '.desc';
        params[dateField + '.lte'] = new Date().toISOString().slice(0, 10);
        params['vote_count.gte'] = 20;
      }
      return list('/discover/' + type, type, params);
    },
    search: function (q) {
      return list('/search/multi', null, { query: q, include_adult: 'false' });
    },
    details: function (type, id) {
      return get('/' + type + '/' + id, { append_to_response: 'videos' }).then(function (json) {
        var item = normalize(json, type);
        item.genres = (json.genres || []).map(function (g) { return g.name; });
        item.runtime = json.runtime || (json.episode_run_time && json.episode_run_time[0]) || 0;
        var vids = (json.videos && json.videos.results) || [];
        var trailer = vids.filter(function (v) { return v.site === 'YouTube' && v.type === 'Trailer'; })[0];
        item.trailerKey = trailer ? trailer.key : '';
        return item;
      });
    },
    hasKey: function () { return CONFIGURED; }
  };
})();
