// Provider registry. To add Plex/Emby: implement the same interface as JellyfinProvider
// (fields, connect, libraryRows, sourceForLocal, findSource) and register it here.
var Providers = (function () {
  var registry = {
    jellyfin: JellyfinProvider,
    framextv: FrameXtvProvider, // built-in online aggregator (direct HLS)
    vidsrc: VidSrcProvider,      // built-in online iframe fallback
    '2embed': Embed2Provider     // built-in online iframe fallback
  };

  // Built-in providers: always available, never shown on the "Add server" form.
  var builtIn = { framextv: true, vidsrc: true, '2embed': true };

  function isBuiltIn(type) { return !!builtIn[type]; }

  // Shown in Settings so users know what's planned.
  var comingSoon = ['Plex', 'Emby'];

  function serverById(id) {
    return Store.get().servers.filter(function (s) { return s.id === id; })[0];
  }

  function userServers() {
    return Store.get().servers.filter(function (s) { return registry[s.type] && !isBuiltIn(s.type); });
  }

  // Build a playable source for an online entry. Handles both shapes:
  //   - frameXTV: entry.mirrors[] of HLS sources → first is primary, the rest
  //     are queued as player fallback mirrors.
  //   - VidSrc / 2Embed: entry.mirrors[] with a single iframe source → played
  //     in a third-party iframe (no subs/audio control), so no fallback list.
  function onlineSource(item, entry) {
    var first = entry.mirrors[0];
    var base = {
      url: first.url,
      title: item.title,
      startSeconds: 0,
      tmdbId: item.tmdbId,
      item: item,
      providerName: entry.providerName,
      noSandbox: !!first.noSandbox
    };
    if (first.type === 'iframe') {
      base.type = 'iframe';
      base.quality = first.quality || '';
      base.note = entry.providerName + '  (iframe)';
      return base;
    }
    var extra = entry.mirrors.length - 1;
    base.type = first.type || 'hls';
    base.quality = first.quality || '';
    base.note = 'frameXTV  ·  ' + entry.providerName + '  (' + (first.quality || 'HLS') + (extra > 0 ? ', +' + extra + ' fallback' : '') + ')';
    base.fallback = entry.mirrors.slice(1).map(function (m) { return m.url; });
    return base;
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

    // --- Online: frameXTV (direct HLS, one entry per extraction provider) plus
    //     the iframe fallbacks (VidSrc, 2Embed) — each at most one entry. ---
    var onlineEntries = (function () {
      var frameXtv = FrameXtvProvider.listProviders().then(function (provs) {
        return Promise.all(provs.map(function (p) {
          var server = { id: p.id, name: p.name };
          return FrameXtvProvider.findSource(server, item).then(function (mirrors) {
            return mirrors.length
              ? { kind: 'online', providerId: p.id, providerName: p.name, tagline: p.tagline, mirrors: mirrors }
              : null;
          });
        })).then(function (list) {
          var found = list.filter(Boolean);
          if (found.length) return found;
          // Safety net: the per-provider endpoints are flaky, so if they all came
          // back empty, the auto endpoint (frameXTV picks a server) usually still
          // finds the title.
          return FrameXtvProvider.autoSource(item).then(function (mirrors) {
            if (!mirrors.length) return [];
            return [{ kind: 'online', providerId: 'auto', providerName: 'frameXTV', tagline: 'auto-picked server', mirrors: mirrors }];
          });
        });
      });
      var vidSrc = registry.vidsrc.findSource({ id: 'vidsrc', name: 'VidSrc' }, item).then(function (mirrors) {
        return mirrors.length ? [{ kind: 'online', providerId: 'vidsrc', providerName: 'VidSrc', mirrors: mirrors }] : [];
      }).catch(function () { return []; });
      var embed2 = registry['2embed'].findSource({ id: '2embed', name: '2Embed' }, item).then(function (mirrors) {
        return mirrors.length ? [{ kind: 'online', providerId: '2embed', providerName: '2Embed', mirrors: mirrors }] : [];
      }).catch(function () { return []; });
      return Promise.all([frameXtv, vidSrc, embed2]).then(function (arr) {
        return [].concat.apply([], arr);
      });
    })();

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
  // else the first online entry that is direct HLS (frameXTV), else the first
  // online iframe, else the placeholder. Direct HLS is preferred for the primary
  // button because it keeps our player controls (subtitles, audio, seek).
  function resolve(item) {
    return sources(item).then(function (res) {
      var serverEntry = res.sections[0].entries[0];
      if (serverEntry) return serverEntry.source;
      var online = res.sections[1].entries;
      for (var i = 0; i < online.length; i++) {
        if (online[i].mirrors[0].type !== 'iframe') return onlineSource(item, online[i]);
      }
      if (online.length) return onlineSource(item, online[0]);
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
