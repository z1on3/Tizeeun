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
  //   - Online: one entry per frameXTV extraction provider that has the title
  //     (HLS mirrors), plus VidSrc and 2Embed (iframe) as the item's IMDB id
  //     becomes known.
  //   - Fallback: the placeholder demo clip (always present).
  //
  // Progressive: each query emits into the live sections as it settles, and
  // calls onUpdate(sections, state) so the UI can render the row immediately
  // instead of waiting for the slowest frameXTV mirror. The returned promise
  // still resolves with the full { sections } once everything has settled
  // (used by resolve() and the tests).
  function sources(item, onUpdate) {
    var sections = [
      { title: 'Your servers', entries: [] },
      { title: 'Online', entries: [] },
      { title: 'Fallback', entries: [] }
    ];
    var state = { done: false };

    function emit() { if (onUpdate) onUpdate(sections, state); }

    var order = userServers();
    if (item.local) {
      var ownId = item.local.serverId;
      order.sort(function (a, b) { return (b.id === ownId ? 1 : 0) - (a.id === ownId ? 1 : 0); });
    }
    var settle = []; // terminal promises for "everything settled"

    function addSettle(p) { settle.push(p); return p; }

    // --- Your servers: stream each entry as it resolves ---
    order.forEach(function (server) {
      var provider = registry[server.type];
      var isLocal = !!(item.local && item.local.serverId === server.id);
      var req = isLocal ? provider.sourceForLocal(server, item) : provider.findSource(server, item);
      addSettle(req.catch(function (err) {
        console.warn('[providers] ' + server.name + ': ' + err.message);
        return null;
      }).then(function (source) {
        if (source) {
          sections[0].entries.push({ kind: 'server', serverName: server.name, isLocal: isLocal, source: source });
          emit();
        }
      }));
    });

    // --- Fallback placeholder: usually instant ---
    addSettle(PlaceholderProvider.findSource(item).catch(function () { return null; }).then(function (source) {
      if (source) {
        sections[2].entries.push({ kind: 'fallback', serverName: 'Demo video', source: source });
        emit();
      }
    }));

    // --- Online iframe fallbacks (VidSrc, 2Embed): each at most one entry ---
    [['vidsrc', 'VidSrc'], ['2embed', '2Embed']].forEach(function (pair) {
      var provider = registry[pair[0]], label = pair[1];
      addSettle(provider.findSource({ id: pair[0], name: label }, item).catch(function () { return []; }).then(function (mirrors) {
        if (mirrors.length) {
          sections[1].entries.push({ kind: 'online', providerId: pair[0], providerName: label, mirrors: mirrors });
          emit();
        }
      }));
    });

    // --- Online frameXTV: stream each extraction provider as it responds. The
    //     auto endpoint runs in parallel as a safety net (a slow/timed-out
    //     per-provider call shouldn't blank the whole group), and is kept only
    //     if it picked a provider the per-provider calls didn't already find. ---
    addSettle(FrameXtvProvider.listProviders().catch(function () { return []; }).then(function (provs) {
      var foundProviders = {};
      var autoEntry = null;
      function pushOnline(entry) {
        sections[1].entries.push(entry);
        emit();
      }
      var perProvider = provs.map(function (p) {
        var server = { id: p.id, name: p.name };
        return FrameXtvProvider.findSource(server, item).catch(function () { return []; }).then(function (mirrors) {
          if (mirrors.length) {
            foundProviders[p.id] = true;
            pushOnline({ kind: 'online', providerId: p.id, providerName: p.name, tagline: p.tagline, mirrors: mirrors });
          }
        });
      });
      var auto = FrameXtvProvider.autoSource(item).catch(function () { return []; }).then(function (mirrors) {
        if (mirrors.length) {
          autoEntry = { kind: 'online', providerId: 'auto', providerName: mirrors[0].providerName || 'frameXTV', tagline: 'auto-picked server', mirrors: mirrors };
        }
      });
      return Promise.all([Promise.all(perProvider), auto]).then(function () {
        if (autoEntry && !foundProviders[autoEntry.providerName] &&
            !sections[1].entries.some(function (e) { return e.providerName === autoEntry.providerName; })) {
          pushOnline(autoEntry);
        }
      });
    }));

    return Promise.all(settle).then(function () {
      state.done = true;
      emit();
      return { sections: sections };
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
