// Provider registry. To add Plex/Emby: implement the same interface as JellyfinProvider
// (fields, connect, libraryRows, sourceForLocal, findSource) and register it here.
var Providers = (function () {
  var registry = {
    jellyfin: JellyfinProvider,
    framextv: FrameXtvProvider // built-in online aggregator; not a user server
  };

  // Built-in providers: always available, never shown on the "Add server" form.
  var builtIn = { framextv: true };

  function isBuiltIn(type) { return !!builtIn[type]; }

  // Shown in Settings so users know what's planned.
  var comingSoon = ['Plex', 'Emby'];

  function serverById(id) {
    return Store.get().servers.filter(function (s) { return s.id === id; })[0];
  }

  function userServers() {
    return Store.get().servers.filter(function (s) { return registry[s.type] && !isBuiltIn(s.type); });
  }

  // Build the primary playable source for an online (frameXTV) entry: its first
  // mirror, with the remaining mirrors queued as fallback for the player.
  function onlineSource(item, entry) {
    var first = entry.mirrors[0];
    var extra = entry.mirrors.length - 1;
    return {
      url: first.url,
      title: item.title,
      note: 'frameXTV  ·  ' + entry.providerName + '  (' + (first.quality || 'HLS') + (extra > 0 ? ', +' + extra + ' fallback' : '') + ')',
      startSeconds: 0,
      type: first.type || 'hls',
      quality: first.quality || '',
      fallback: entry.mirrors.slice(1).map(function (m) { return m.url; })
    };
  }

  // Aggregate every playable source for a title into three sections:
  //   - Your servers: one entry per connected server that has the title.
  //   - Online: one entry per frameXTV extraction provider that has the title,
  //     each carrying its list of HLS mirrors.
  //   - Fallback: the placeholder demo clip (always present).
  // Resolves to { sections: [ { title, entries: [...] } ] }.
  function sources(item) {
    var order = userServers();
    if (item.local) {
      var ownId = item.local.serverId;
      order.sort(function (a, b) { return (b.id === ownId ? 1 : 0) - (a.id === ownId ? 1 : 0); });
    }

    // --- Your servers (one entry per server that has it) ---
    var serverEntries = order.map(function (server) {
      var provider = registry[server.type];
      var isLocal = !!(item.local && item.local.serverId === server.id);
      var req = isLocal ? provider.sourceForLocal(server, item) : provider.findSource(server, item);
      return req.catch(function (err) {
        console.warn('[providers] ' + server.name + ': ' + err.message);
        return null;
      }).then(function (source) {
        return source
          ? { kind: 'server', serverName: server.name, isLocal: isLocal, source: source }
          : null;
      });
    });

    // --- Online (one entry per available frameXTV extraction provider) ---
    var onlineEntries = FrameXtvProvider.listProviders().then(function (provs) {
      return Promise.all(provs.map(function (p) {
        var server = { id: p.id, name: p.name };
        return FrameXtvProvider.findSource(server, item).then(function (mirrors) {
          return mirrors.length
            ? { kind: 'online', providerId: p.id, providerName: p.name, tagline: p.tagline, mirrors: mirrors }
            : null;
        });
      }));
    });

    // --- Fallback (placeholder, always) ---
    var fallbackEntry = PlaceholderProvider.findSource(item).then(function (source) {
      return { kind: 'fallback', serverName: 'Demo video', source: source };
    });

    return Promise.all([
      Promise.all(serverEntries).then(function (l) { return l.filter(Boolean); }),
      onlineEntries.then(function (l) { return l.filter(Boolean); }),
      fallbackEntry
    ]).then(function (arr) {
      var serverEntries = arr[0], onlineEntries = arr[1], fallbackEntry = arr[2];
      return {
        sections: [
          { title: 'Your servers', entries: serverEntries },
          { title: 'Online', entries: onlineEntries },
          { title: 'Fallback', entries: [fallbackEntry] }
        ]
      };
    });
  }

  // Pick the single best source for a one-tap "Play": first your-server copy,
  // else the first online mirror, else the placeholder.
  function resolve(item) {
    return sources(item).then(function (res) {
      var serverEntry = res.sections[0].entries[0];
      if (serverEntry) return serverEntry.source;
      var onlineEntry = res.sections[1].entries[0];
      if (onlineEntry) return onlineSource(item, onlineEntry);
      return res.sections[2].entries[0].source;
    });
  }

  function libraryRows() {
    var rows = [];
    Store.get().servers.forEach(function (server) {
      var provider = registry[server.type];
      if (provider) rows = rows.concat(provider.libraryRows(server));
    });
    return rows;
  }

  // Browse → "My library": every server's matching items, merged.
  function browseLibrary(opts) {
    var servers = Store.get().servers.filter(function (s) { return registry[s.type] && registry[s.type].browse; });
    return Promise.all(servers.map(function (server) {
      return registry[server.type].browse(server, opts).catch(function (err) {
        console.warn('[providers] ' + server.name + ': ' + err.message);
        return [];
      });
    })).then(function (lists) { return [].concat.apply([], lists); });
  }

  return {
    get: function (type) { return registry[type]; },
    browseLibrary: browseLibrary,
    hasServers: function () { return Store.get().servers.length > 0; },
    // Provider types shown on the "Add server" form (built-ins like frameXTV
    // have no login, so they're excluded here but still available via get()).
    types: function () {
      return Object.keys(registry).filter(function (t) { return !isBuiltIn(t); });
    },
    comingSoon: comingSoon,
    resolve: resolve,
    sources: sources,
    onlineSource: onlineSource,
    libraryRows: libraryRows
  };
})();
