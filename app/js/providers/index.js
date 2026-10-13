// Provider registry. To add Plex/Emby: implement the same interface as JellyfinProvider
// (fields, connect, libraryRows, sourceForLocal, findSource) and register it here.
var Providers = (function () {
  var registry = {
    jellyfin: JellyfinProvider
  };

  // Shown in Settings so users know what's planned.
  var comingSoon = ['Plex', 'Emby'];

  function serverById(id) {
    return Store.get().servers.filter(function (s) { return s.id === id; })[0];
  }

  // Try each connected server in order; fall back to the placeholder clip.
  function resolve(item) {
    if (item.local) {
      var server = serverById(item.local.serverId);
      var provider = server && registry[server.type];
      if (provider) return provider.sourceForLocal(server, item);
    }

    var servers = Store.get().servers.filter(function (s) { return registry[s.type]; });
    var i = 0;
    function next() {
      if (i >= servers.length) return PlaceholderProvider.findSource(item);
      var server = servers[i++];
      return registry[server.type].findSource(server, item)
        .catch(function (err) {
          console.warn('[providers] ' + server.name + ': ' + err.message);
          return null;
        })
        .then(function (source) { return source || next(); });
    }
    return next();
  }

  function libraryRows() {
    var rows = [];
    Store.get().servers.forEach(function (server) {
      var provider = registry[server.type];
      if (provider) rows = rows.concat(provider.libraryRows(server));
    });
    return rows;
  }

  return {
    get: function (type) { return registry[type]; },
    types: function () { return Object.keys(registry); },
    comingSoon: comingSoon,
    resolve: resolve,
    libraryRows: libraryRows
  };
})();
