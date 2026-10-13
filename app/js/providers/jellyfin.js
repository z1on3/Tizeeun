// Jellyfin provider: login, library rows, and matching TMDB titles to library items.
var JellyfinProvider = (function () {
  var CLIENT = 'Tizeeun';
  var VERSION = '0.1.0';

  function authHeader(server) {
    var parts = [
      'Client="' + CLIENT + '"',
      'Device="Samsung TV"',
      'DeviceId="' + Store.get().deviceId + '"',
      'Version="' + VERSION + '"'
    ];
    if (server && server.token) parts.push('Token="' + server.token + '"');
    return 'MediaBrowser ' + parts.join(', ');
  }

  function normalizeUrl(url) {
    url = (url || '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
    return url;
  }

  function request(server, method, path, body) {
    var opts = {
      method: method,
      headers: { Authorization: authHeader(server), Accept: 'application/json' }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(server.url + path, opts).then(function (res) {
      if (res.status === 401) throw new Error('Jellyfin rejected the login (401)');
      if (!res.ok) throw new Error('Jellyfin ' + res.status);
      return res.status === 204 ? null : res.json();
    });
  }

  function image(server, id, kind, size) {
    return server.url + '/Items/' + id + '/Images/' + kind + '?' + size + '&quality=85';
  }

  // Map a Jellyfin item into the shared UI item shape.
  function toItem(server, it) {
    var isEpisode = it.Type === 'Episode';
    var artId = isEpisode && it.SeriesId ? it.SeriesId : it.Id;
    var title = isEpisode
      ? (it.SeriesName || '') + ' · S' + (it.ParentIndexNumber || 0) + 'E' + (it.IndexNumber || 0)
      : it.Name;
    var tmdb = it.ProviderIds && it.ProviderIds.Tmdb;
    return {
      tmdbId: tmdb ? Number(tmdb) : null,
      type: it.Type === 'Movie' ? 'movie' : 'tv',
      title: title,
      year: it.ProductionYear ? String(it.ProductionYear) : '',
      overview: it.Overview || '',
      rating: it.CommunityRating ? it.CommunityRating.toFixed(1) : '',
      poster: image(server, artId, 'Primary', 'maxHeight=480'),
      backdrop: image(server, artId, 'Backdrop', 'maxWidth=1280'),
      local: { serverId: server.id, itemId: it.Id, kind: it.Type }
    };
  }

  function streamUrl(server, itemId) {
    // Both spellings: `ApiKey` (10.10+) and legacy `api_key`.
    return server.url + '/Videos/' + itemId + '/stream?static=true' +
      '&ApiKey=' + encodeURIComponent(server.token) +
      '&api_key=' + encodeURIComponent(server.token);
  }

  function sourceFor(server, it, displayTitle) {
    var ticks = it.UserData && it.UserData.PlaybackPositionTicks;
    return {
      url: streamUrl(server, it.Id),
      title: displayTitle,
      note: 'Playing from ' + server.name,
      startSeconds: ticks ? Math.floor(ticks / 10000000) : 0
    };
  }

  // Series aren't playable themselves: pick next-up, else the first episode.
  function episodeForSeries(server, seriesId) {
    var uid = server.userId;
    return request(server, 'GET', '/Shows/NextUp?seriesId=' + seriesId + '&userId=' + uid + '&Limit=1')
      .then(function (res) {
        if (res.Items && res.Items.length) return res.Items[0];
        return request(server, 'GET', '/Shows/' + seriesId + '/Episodes?userId=' + uid + '&Limit=1')
          .then(function (eps) { return eps.Items && eps.Items[0]; });
      });
  }

  function playableFor(server, it) {
    if (it.Type !== 'Series') return Promise.resolve(it);
    return episodeForSeries(server, it.Id);
  }

  return {
    type: 'jellyfin',
    label: 'Jellyfin',
    fields: [
      { name: 'url', label: 'Server address', placeholder: 'http://192.168.1.10:8096' },
      { name: 'username', label: 'Username', placeholder: '' },
      { name: 'password', label: 'Password', placeholder: '', secret: true }
    ],

    connect: function (form) {
      var url = normalizeUrl(form.url);
      if (!url) return Promise.reject(new Error('Server address is required'));
      var probe = { url: url };
      return request(probe, 'GET', '/System/Info/Public').then(function (info) {
        return request(probe, 'POST', '/Users/AuthenticateByName', {
          Username: form.username || '',
          Pw: form.password || ''
        }).then(function (auth) {
          return {
            type: 'jellyfin',
            name: info.ServerName || 'Jellyfin',
            url: url,
            token: auth.AccessToken,
            userId: auth.User.Id,
            username: auth.User.Name
          };
        });
      });
    },

    libraryRows: function (server) {
      var uid = server.userId;
      var fields = '&Fields=ProviderIds,Overview,ProductionYear&EnableUserData=true';
      return [
        {
          title: 'Continue watching · ' + server.name,
          load: function () {
            return request(server, 'GET', '/Users/' + uid + '/Items/Resume?Limit=20&MediaTypes=Video' + fields)
              .then(function (res) { return (res.Items || []).map(function (it) { return toItem(server, it); }); });
          }
        },
        {
          title: 'Latest on ' + server.name,
          load: function () {
            return request(server, 'GET', '/Users/' + uid + '/Items/Latest?Limit=20' + fields)
              .then(function (items) { return (items || []).map(function (it) { return toItem(server, it); }); });
          }
        }
      ];
    },

    // Item came from this server's library: play it directly.
    sourceForLocal: function (server, item) {
      return request(server, 'GET', '/Users/' + server.userId + '/Items/' + item.local.itemId)
        .then(function (it) { return playableFor(server, it); })
        .then(function (it) { return it ? sourceFor(server, it, item.title) : null; });
    },

    // Item came from TMDB: look it up by TMDB id, falling back to title + year.
    findSource: function (server, item) {
      var types = item.type === 'movie' ? 'Movie' : 'Series';
      var path = '/Users/' + server.userId + '/Items?Recursive=true&Limit=25' +
        '&IncludeItemTypes=' + types +
        '&Fields=ProviderIds,ProductionYear&EnableUserData=true' +
        '&searchTerm=' + encodeURIComponent(item.title);
      return request(server, 'GET', path).then(function (res) {
        var items = res.Items || [];
        var match = items.filter(function (it) {
          return it.ProviderIds && String(it.ProviderIds.Tmdb) === String(item.tmdbId);
        })[0] || items.filter(function (it) {
          return it.Name.toLowerCase() === item.title.toLowerCase() &&
            (!item.year || String(it.ProductionYear) === item.year);
        })[0];
        if (!match) return null;
        return playableFor(server, match).then(function (it) {
          return it ? sourceFor(server, it, item.title) : null;
        });
      });
    }
  };
})();
