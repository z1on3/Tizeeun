// Screens. Each view renders into a container; App handles routing and focus.

// Tiny DOM builder. Text children are inserted as text nodes, so API data is never parsed as HTML.
function h(tag, attrs, children) {
  var el = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) {
    var v = attrs[k];
    if (v === undefined || v === null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  });
  (Array.isArray(children) ? children : [children]).forEach(function (c) {
    if (c === undefined || c === null || c === false) return;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  });
  return el;
}

// Full-screen backdrop that crossfades to the focused title's art.
var Ambient = (function () {
  var root = document.getElementById('ambient');
  var layers = root.querySelectorAll('.amb-layer');
  var front = 0;
  var wanted = '';
  var timer = null;

  function apply(url) {
    if (!url) {
      layers[0].classList.remove('on');
      layers[1].classList.remove('on');
      return;
    }
    var img = new Image();
    img.onload = function () {
      if (url !== wanted) return;
      var next = layers[1 - front];
      next.style.backgroundImage = 'url("' + encodeURI(url) + '")';
      next.classList.add('on');
      layers[front].classList.remove('on');
      front = 1 - front;
    };
    img.onerror = function () { if (url === wanted) apply(''); };
    img.src = url;
  }

  return {
    // mode: 'spot' (home), 'full' (details), 'off'
    mode: function (m) { root.className = m; },
    show: function (url) {
      url = url || '';
      if (url === wanted) return;
      wanted = url;
      clearTimeout(timer);
      // Debounced so holding an arrow key doesn't fetch every backdrop on the way.
      timer = setTimeout(function () { apply(url); }, 160);
    }
  };
})();

var Views = (function () {

  var sourcesPanel = null; // current Details view's right-hand source list

  // ---------- Shared pieces ----------

  function slate(item, extra) {
    var parts = [item.year, item.type === 'tv' ? 'Series' : 'Movie'];
    if (item.runtime) parts.push(item.runtime + ' min');
    if (item.rating) parts.push('★ ' + item.rating);
    if (item.sourceLabel) parts.push('On ' + item.sourceLabel);
    return parts.concat(extra || []).filter(Boolean).join('  ·  ');
  }

  function card(item) {
    var img = item.poster ? h('img', { src: item.poster, alt: '' }) : null;
    if (img) img.addEventListener('error', function () { img.remove(); });
    var el = h('button', {
      class: 'card focusable',
      onclick: function () { App.go('details', { item: item }); }
    }, [
      h('div', { class: 'poster' }, [
        h('span', { class: 'poster-fallback' }, item.title),
        img,
        item.local ? h('span', { class: 'owned', title: 'In your library' }) : null
      ])
    ]);
    el._item = item;
    return el;
  }

  // Small fixed panel showing whatever card is focused (Browse, Search).
  function focusLine() {
    return h('div', { class: 'focus-line' }, [
      h('span', { class: 'fl-title' }, ''),
      h('span', { class: 'slate' }, '')
    ]);
  }

  function updateFocusLine(line, item) {
    line.children[0].textContent = item.title;
    line.children[1].textContent = slate(item);
  }

  function emptyState(title, text, actionLabel, route) {
    return h('section', { class: 'empty' }, [
      h('h1', { class: 'display' }, title),
      h('p', {}, text),
      actionLabel ? h('button', { class: 'btn primary focusable', onclick: function () { App.go(route); } }, actionLabel) : null
    ]);
  }

  // Focused cards drive the spotlight / focus line of whichever view is showing.
  Nav.onFocus(function (el) {
    var item = el._item;
    if (!item) return;
    var spot = document.querySelector('.spotlight');
    if (spot) {
      spot.querySelector('.spot-title').textContent = item.title;
      spot.querySelector('.slate').textContent = slate(item);
      spot.querySelector('.spot-overview').textContent = item.overview || '';
      Ambient.show(item.backdrop);
    }
    var line = document.querySelector('.focus-line');
    if (line) updateFocusLine(line, item);
  });

  // ---------- Home: spotlight + poster rows ----------

  var homeAutoFocus = false;
  document.addEventListener('keydown', function () { homeAutoFocus = false; }, true);

  function row(def) {
    var track = h('div', { class: 'row-track' }, [h('div', { class: 'row-note' }, 'Loading…')]);
    var el = h('section', { class: 'row' }, [h('h2', { class: 'label' }, def.title), track]);
    def.load().then(function (items) {
      if (!items.length) { el.remove(); return; }
      track.innerHTML = '';
      items.forEach(function (it) { track.appendChild(card(it)); });
      if (def.onLoaded) def.onLoaded();
    }).catch(function (err) {
      track.innerHTML = '';
      track.appendChild(h('div', { class: 'row-note' }, 'Couldn\'t load this row: ' + err.message));
    });
    return el;
  }

  function home(root) {
    var hasTmdb = TMDB.hasKey();
    var libRows = Providers.libraryRows();
    Ambient.mode('spot');

    if (!hasTmdb && !libRows.length) {
      Ambient.show('');
      root.appendChild(emptyState(
        'Your cinema, on the big screen.',
        "The movie catalog isn't available in this build. Connect your Jellyfin server to browse and play your own library.",
        'Open settings', 'settings'));
      return;
    }

    // Until the user presses a key, keep focus on the top-most row that has loaded,
    // whichever order the rows arrive in. Focusing a card also fills the spotlight.
    homeAutoFocus = true;
    var rows = libRows.concat(hasTmdb ? TMDB.rows().slice(0, 4) : []);
    rows.forEach(function (def) {
      def.onLoaded = function () {
        if (!homeAutoFocus) return;
        var first = rowsBox.querySelector('.card');
        if (first && first !== Nav.current()) Nav.focus(first);
      };
    });
    var rowsBox = h('div', { class: 'rows scroll-y', 'data-snap': 'row' }, rows.map(row));
    root.appendChild(h('section', { class: 'home' }, [
      h('div', { class: 'spotlight' }, [
        h('h1', { class: 'display spot-title' }, ''),
        h('div', { class: 'slate' }, ''),
        h('p', { class: 'spot-overview' }, '')
      ]),
      rowsBox
    ]));
  }

  // ---------- Details (streaming aggregator) ----------
  // Shows the title's info on the left and every playable source on the right,
  // grouped: your media servers, frameXTV online mirrors, and the fallback
  // placeholder. Selecting a source plays it directly; the primary "Play"
  // button still auto-picks the best one.

  function sourceRow(item, entry) {
    var name, sub, tag, cls = 'source-row focusable', src;
    if (entry.kind === 'online') {
      name = entry.providerName;
      sub = (entry.mirrors[0].quality || 'HLS') + '  ·  ' + entry.mirrors.length + ' mirror' + (entry.mirrors.length > 1 ? 's' : '');
      tag = 'frameXTV';
      src = Providers.onlineSource(item, entry);
    } else if (entry.kind === 'fallback') {
      name = 'Demo video';
      sub = entry.source.note || '';
      tag = 'Placeholder';
      src = entry.source;
    } else {
      name = entry.serverName;
      sub = entry.source.note || '';
      tag = entry.isLocal ? 'Your library' : '';
      cls += entry.isLocal ? ' own' : '';
      src = entry.source;
    }
    var row = h('button', {
      class: cls,
      onclick: function () { App.playSource(src, row); }
    }, [
      h('span', { class: 'source-name' }, name),
      h('span', { class: 'source-sub' }, sub),
      tag ? h('span', { class: 'source-tag' }, tag) : null,
      h('span', { class: 'source-play' }, 'Play')
    ]);
    return row;
  }

  function renderSources(full) {
    sourcesPanel.innerHTML = '';
    sourcesPanel.appendChild(h('h2', { class: 'sources-title' }, 'Available sources'));
    var list = h('div', { class: 'sources scroll-y', 'data-pad-top': '16' },
      [h('div', { class: 'row-note' }, 'Finding sources…')]);
    sourcesPanel.appendChild(list);

    Providers.sources(full).then(function (res) {
      if (!document.body.contains(sourcesPanel)) return;
      list.innerHTML = '';
      var any = false;
      res.sections.forEach(function (sec) {
        if (!sec.entries.length) return;
        any = true;
        list.appendChild(h('div', { class: 'source-section-label' }, sec.title));
        sec.entries.forEach(function (entry) { list.appendChild(sourceRow(full, entry)); });
      });
      if (!any) list.appendChild(h('div', { class: 'row-note' }, 'No sources available.'));
    }).catch(function (err) {
      list.innerHTML = '';
      list.appendChild(h('div', { class: 'row-note' }, 'Couldn\'t find sources: ' + err.message));
    });
  }

  function details(root, params) {
    var item = params.item;
    var body = h('div', { class: 'details-body' });
    sourcesPanel = h('div', { class: 'sources-panel' });
    root.appendChild(h('section', { class: 'details' }, [body, sourcesPanel]));
    Ambient.mode('full');
    Ambient.show(item.backdrop);

    function renderInfo(full) {
      body.innerHTML = '';
      body.appendChild(h('h1', { class: 'display' }, full.title));
      body.appendChild(h('div', { class: 'slate' }, slate(full)));
      if (full.genres && full.genres.length) body.appendChild(h('div', { class: 'genres' }, full.genres.join('  /  ')));
      body.appendChild(h('p', { class: 'overview' }, full.overview || 'No description available.'));
      body.appendChild(h('div', { class: 'actions' }, [
        h('button', { class: 'btn primary focusable', onclick: function () { App.play(full); } }, 'Play'),
        h('button', { class: 'btn focusable', onclick: function () { App.back(); } }, 'Back')
      ]));
      Nav.focusFirst(body);
    }

    renderInfo(item);
    renderSources(item);

    if (item.tmdbId && TMDB.hasKey()) {
      TMDB.details(item.type, item.tmdbId).then(function (full) {
        full.local = item.local; // keep the direct-play link for library items
        full.sourceLabel = item.sourceLabel;
        if (item.local) full.title = item.title;
        if (!document.body.contains(body)) return;
        renderInfo(full);
        renderSources(full);
        Ambient.show(full.backdrop || item.backdrop);
      }).catch(function () {});
    }
  }

  // ---------- Browse: filters + grid ----------

  var FALLBACK_GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary',
    'Drama', 'Family', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Science Fiction', 'Thriller'];

  var filters = null; // kept across visits: { type, source, sort, genre: {id, name} | null }

  function segmented(options, value, onPick) {
    var group = h('div', { class: 'seg' });
    options.forEach(function (opt) {
      var b = h('button', {
        class: 'seg-btn focusable' + (opt.value === value ? ' on' : ''),
        onclick: function () {
          var siblings = group.querySelectorAll('.seg-btn');
          for (var i = 0; i < siblings.length; i++) siblings[i].classList.remove('on');
          b.classList.add('on');
          onPick(opt.value);
        }
      }, opt.label);
      group.appendChild(b);
    });
    return group;
  }

  function browse(root) {
    Ambient.mode('off');
    if (!filters) {
      filters = {
        type: 'movie',
        source: TMDB.hasKey() || !Providers.hasServers() ? 'all' : 'library',
        sort: 'popular',
        genre: null
      };
    }

    var chips = h('div', { class: 'row-track chips' });
    var line = focusLine();
    var grid = h('div', { class: 'grid' });
    var status = h('p', { class: 'status' });
    var requestId = 0;

    function loadResults() {
      var id = ++requestId;
      grid.innerHTML = '';
      line.children[0].textContent = '';
      line.children[1].textContent = '';

      if (filters.source === 'all' && !TMDB.hasKey()) {
        status.textContent = "The full catalog isn't available in this build. Switch to My library.";
        return;
      }
      if (filters.source === 'library' && !Providers.hasServers()) {
        status.textContent = 'Connect a server in Settings to browse your library.';
        return;
      }
      status.textContent = 'Loading…';

      var req = filters.source === 'all'
        ? TMDB.discover(filters.type, { genreId: filters.genre && filters.genre.id, sort: filters.sort })
        : Providers.browseLibrary({ type: filters.type, genre: filters.genre && filters.genre.name, sort: filters.sort });

      req.then(function (items) {
        if (id !== requestId) return;
        status.textContent = items.length ? '' : 'Nothing matches these filters. Try another genre.';
        items.forEach(function (it) { grid.appendChild(card(it)); });
      }).catch(function (err) {
        if (id === requestId) status.textContent = 'Couldn\'t load results: ' + err.message;
      });
    }

    function loadGenres() {
      var req = TMDB.hasKey()
        ? TMDB.genres(filters.type)
        : Promise.resolve(FALLBACK_GENRES.map(function (name) { return { id: null, name: name }; }));
      return req.catch(function () { return []; }).then(function (genres) {
        chips.innerHTML = '';
        var all = [{ id: null, name: 'All genres' }].concat(genres);
        all.forEach(function (g) {
          var isOn = filters.genre ? filters.genre.name === g.name : g.name === 'All genres';
          var chip = h('button', {
            class: 'chip focusable' + (isOn ? ' on' : ''),
            onclick: function () {
              var on = chips.querySelector('.chip.on');
              if (on) on.classList.remove('on');
              chip.classList.add('on');
              filters.genre = g.id || g.name !== 'All genres' ? g : null;
              loadResults();
            }
          }, g.name);
          chips.appendChild(chip);
        });
      });
    }

    var bar = h('div', { class: 'filter-bar' }, [
      segmented([{ value: 'movie', label: 'Movies' }, { value: 'tv', label: 'Series' }], filters.type, function (v) {
        filters.type = v;
        filters.genre = null; // genre ids differ between movies and series
        loadGenres().then(loadResults);
      }),
      segmented([{ value: 'all', label: 'Everywhere' }, { value: 'library', label: 'My library' }], filters.source, function (v) {
        filters.source = v;
        loadResults();
      }),
      segmented([{ value: 'popular', label: 'Popular' }, { value: 'top', label: 'Top rated' }, { value: 'newest', label: 'Newest' }], filters.sort, function (v) {
        filters.sort = v;
        loadResults();
      })
    ]);

    root.appendChild(h('section', { class: 'page browse scroll-y', 'data-pad-top': '150' }, [
      bar, chips, line, status, grid
    ]));
    loadGenres();
    loadResults();
    Nav.focusFirst(bar);
  }

  // ---------- Search ----------

  var lastQuery = '';
  function search(root) {
    Ambient.mode('off');
    var grid = h('div', { class: 'grid' });
    var line = focusLine();
    var status = h('p', { class: 'status' }, TMDB.hasKey() ? 'Type a title, then press OK.' : "Search isn't available in this build.");
    var input = h('input', {
      class: 'text search-input focusable', type: 'text', placeholder: 'Search movies and series', value: lastQuery
    });
    var timer = null;

    function run() {
      var q = input.value.trim();
      lastQuery = q;
      if (!q || !TMDB.hasKey()) return;
      status.textContent = 'Searching…';
      TMDB.search(q).then(function (items) {
        grid.innerHTML = '';
        status.textContent = items.length ? '' : 'No results for "' + q + '".';
        items.forEach(function (it) { grid.appendChild(card(it)); });
      }).catch(function (err) { status.textContent = 'Search failed: ' + err.message; });
    }

    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 600); });
    input.addEventListener('keydown', function (e) { if (e.keyCode === Keys.ENTER) { clearTimeout(timer); run(); } });

    root.appendChild(h('section', { class: 'page scroll-y', 'data-pad-top': '150' }, [input, line, status, grid]));
    if (lastQuery) run();
    Nav.focus(input);
  }

  // ---------- Settings ----------

  function field(label, input) {
    return h('label', { class: 'field' }, [h('span', { class: 'label' }, label), input]);
  }

  function settings(root) {
    Ambient.mode('off');
    var page = h('section', { class: 'page settings scroll-y', 'data-pad-top': '150' });
    root.appendChild(page);
    page.appendChild(h('h1', { class: 'display page-title' }, 'Settings'));

    // Servers
    var servers = Store.get().servers;
    var list = h('div', { class: 'server-list' }, servers.length ? servers.map(function (s) {
      return h('div', { class: 'server' }, [
        h('div', {}, [
          h('div', { class: 'server-name' }, s.name),
          h('div', { class: 'slate' }, s.type + '  ·  ' + s.url + '  ·  ' + s.username)
        ]),
        h('button', {
          class: 'btn small focusable',
          onclick: function () { Store.removeServer(s.id); App.go('settings', {}, true); App.toast('Server removed'); }
        }, 'Remove')
      ]);
    }) : h('p', { class: 'hint-text' }, 'No servers yet.'));

    var addArea = h('div', { class: 'add-area' });
    var typeButtons = Providers.types().map(function (type) {
      return h('button', { class: 'btn focusable', onclick: function () { showForm(type); } }, 'Add ' + Providers.get(type).label);
    }).concat(Providers.comingSoon.map(function (name) {
      return h('button', { class: 'btn', disabled: true }, name + ' (soon)');
    }));

    page.appendChild(h('div', { class: 'panel' }, [
      h('h2', {}, 'Media servers'),
      h('p', { class: 'hint-text' }, 'Titles on your servers play from there. Everything else plays a placeholder video.'),
      list,
      h('div', { class: 'actions' }, typeButtons),
      addArea
    ]));

    function showForm(type) {
      var provider = Providers.get(type);
      var inputs = {};
      var status = h('p', { class: 'hint-text' });
      addArea.innerHTML = '';
      var form = h('div', { class: 'form' }, provider.fields.map(function (f) {
        inputs[f.name] = h('input', {
          class: 'text focusable', type: f.secret ? 'password' : 'text', placeholder: f.placeholder
        });
        return field(f.label, inputs[f.name]);
      }));
      var connectBtn = h('button', {
        class: 'btn primary focusable',
        onclick: function () {
          var values = {};
          Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value; });
          status.textContent = 'Connecting…';
          connectBtn.disabled = true;
          provider.connect(values).then(function (server) {
            Store.addServer(server);
            App.toast('Connected to ' + server.name);
            App.go('settings', {}, true);
          }).catch(function (err) {
            connectBtn.disabled = false;
            status.textContent = 'Couldn\'t connect: ' + err.message +
              (err instanceof TypeError ? '. Check the address, and that the server is reachable over the same http/https.' : '');
          });
        }
      }, 'Connect');
      addArea.appendChild(h('div', { class: 'panel inner' }, [h('h3', {}, 'Add ' + provider.label), form, connectBtn, status]));
      Nav.focusFirst(form);
    }

    // Start on "Add …", never on a destructive "Remove".
    Nav.focus(typeButtons[0]);
  }

  return { home: home, details: details, browse: browse, search: search, settings: settings };
})();
