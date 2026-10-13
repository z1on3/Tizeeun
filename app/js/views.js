// Screens. Each view renders into a container and returns the element to focus first.

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

var Views = (function () {

  function card(item) {
    var img = h('img', { src: item.poster || undefined, alt: '', loading: 'lazy' });
    img.addEventListener('error', function () { img.remove(); });
    return h('button', {
      class: 'card focusable',
      onclick: function () { App.go('details', { item: item }); }
    }, [
      h('div', { class: 'poster' }, [h('span', { class: 'poster-fallback' }, item.title), item.poster ? img : null]),
      h('div', { class: 'card-title' }, item.title),
      h('div', { class: 'card-meta' }, [item.year, item.rating ? ' · ★ ' + item.rating : ''].join(''))
    ]);
  }

  // A horizontal row that loads its items asynchronously and removes itself if empty.
  function row(def) {
    var track = h('div', { class: 'row-track' }, [h('div', { class: 'row-loading' }, 'Loading…')]);
    var el = h('section', { class: 'row' }, [h('h2', {}, def.title), track]);
    def.load().then(function (items) {
      if (!items.length) { el.remove(); return; }
      track.innerHTML = '';
      items.forEach(function (it) { track.appendChild(card(it)); });
      var cur = Nav.current();
      if (!cur || !document.body.contains(cur)) Nav.focusFirst(track);
    }).catch(function (err) {
      track.innerHTML = '';
      track.appendChild(h('div', { class: 'row-error' }, 'Could not load: ' + err.message));
    });
    return el;
  }

  function hero(item) {
    return h('section', {
      class: 'hero',
      style: item.backdrop ? 'background-image:url("' + encodeURI(item.backdrop) + '")' : ''
    }, [
      h('div', { class: 'hero-shade' }),
      h('div', { class: 'hero-body' }, [
        h('h1', {}, item.title),
        h('div', { class: 'meta' }, [item.year, item.rating ? '★ ' + item.rating : ''].filter(Boolean).join('  ·  ')),
        h('p', { class: 'overview' }, item.overview),
        h('div', { class: 'actions' }, [
          h('button', { class: 'btn primary focusable', onclick: function () { App.play(item); } }, '▶  Play'),
          h('button', { class: 'btn focusable', onclick: function () { App.go('details', { item: item }); } }, 'More info')
        ])
      ])
    ]);
  }

  function emptyState(title, text, actionLabel, route) {
    return h('section', { class: 'empty' }, [
      h('h1', {}, title),
      h('p', {}, text),
      h('button', { class: 'btn primary focusable', onclick: function () { App.go(route); } }, actionLabel)
    ]);
  }

  // ---------- Home ----------
  function home(root) {
    var hasTmdb = TMDB.hasKey();
    var libRows = Providers.libraryRows();

    if (!hasTmdb && !libRows.length) {
      root.appendChild(emptyState(
        'Welcome to Tizeeun',
        'Add a free TMDB API key to browse movies and series, and connect a Jellyfin server to play your own library.',
        'Open Settings', 'settings'));
      return;
    }

    var heroSlot = h('div', { class: 'hero-slot' });
    root.appendChild(heroSlot);
    libRows.forEach(function (def) { root.appendChild(row(def)); });

    if (hasTmdb) {
      var rows = TMDB.rows();
      // Reuse the first row's data for the hero banner.
      var first = rows[0];
      var firstLoad = first.load();
      first.load = function () { return firstLoad; };
      firstLoad.then(function (items) {
        var pick = items.filter(function (i) { return i.backdrop; })[0];
        if (!pick) return;
        heroSlot.appendChild(hero(pick));
        // Only steal focus if the user hasn't moved yet.
        var cur = Nav.current();
        if (!cur || !document.body.contains(cur) || cur.classList.contains('tab')) Nav.focusFirst(heroSlot);
      }).catch(function () {});
      rows.forEach(function (def) { root.appendChild(row(def)); });
    } else {
      root.appendChild(h('p', { class: 'muted pad' }, 'Tip: add a TMDB API key in Settings to discover more titles.'));
    }
  }

  // ---------- Details ----------
  function details(root, params) {
    var item = params.item;
    var body = h('div', { class: 'details-body' });
    var page = h('section', {
      class: 'details',
      style: item.backdrop ? 'background-image:url("' + encodeURI(item.backdrop) + '")' : ''
    }, [h('div', { class: 'hero-shade' }), body]);
    root.appendChild(page);

    function render(full) {
      body.innerHTML = '';
      var meta = [full.year, full.type === 'tv' ? 'Series' : 'Movie',
        full.runtime ? full.runtime + ' min' : '', full.rating ? '★ ' + full.rating : '']
        .filter(Boolean).join('  ·  ');
      body.appendChild(h('h1', {}, full.title));
      body.appendChild(h('div', { class: 'meta' }, meta));
      if (full.genres && full.genres.length) body.appendChild(h('div', { class: 'genres' }, full.genres.join(' / ')));
      body.appendChild(h('p', { class: 'overview long' }, full.overview || 'No description available.'));
      body.appendChild(h('div', { class: 'actions' }, [
        h('button', { class: 'btn primary focusable', onclick: function () { App.play(full); } }, '▶  Play'),
        h('button', { class: 'btn focusable', onclick: function () { App.back(); } }, 'Back')
      ]));
      Nav.focusFirst(body);
    }

    render(item);
    if (item.tmdbId && TMDB.hasKey()) {
      TMDB.details(item.type, item.tmdbId).then(function (full) {
        full.local = item.local; // keep the direct-play link for library items
        if (item.local) full.title = item.title;
        render(full);
      }).catch(function () {});
    }
  }

  // ---------- Search ----------
  var lastQuery = '';
  function search(root) {
    var results = h('div', { class: 'grid' });
    var status = h('p', { class: 'muted' }, TMDB.hasKey() ? 'Type a title and press OK.' : 'Search needs a TMDB API key (Settings).');
    var input = h('input', {
      class: 'text focusable', type: 'text', placeholder: 'Search movies & series', value: lastQuery
    });
    var timer = null;

    function run() {
      var q = input.value.trim();
      lastQuery = q;
      if (!q || !TMDB.hasKey()) return;
      status.textContent = 'Searching…';
      TMDB.search(q).then(function (items) {
        results.innerHTML = '';
        status.textContent = items.length ? '' : 'No results for "' + q + '".';
        items.forEach(function (it) { results.appendChild(card(it)); });
      }).catch(function (err) { status.textContent = 'Search failed: ' + err.message; });
    }

    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 600); });
    input.addEventListener('keydown', function (e) { if (e.keyCode === Keys.ENTER) { clearTimeout(timer); run(); } });

    root.appendChild(h('section', { class: 'page' }, [h('h1', {}, 'Search'), input, status, results]));
    if (lastQuery) run();
    Nav.focus(input);
  }

  // ---------- Settings ----------
  function field(label, input) {
    return h('label', { class: 'field' }, [h('span', {}, label), input]);
  }

  function settings(root, params) {
    var page = h('section', { class: 'page settings' });
    root.appendChild(page);
    page.appendChild(h('h1', {}, 'Settings'));

    // TMDB
    var keyInput = h('input', { class: 'text focusable', type: 'text', value: Store.get().tmdbKey, placeholder: 'TMDB API key or read access token' });
    page.appendChild(h('div', { class: 'panel' }, [
      h('h2', {}, 'Catalog (TMDB)'),
      h('p', { class: 'muted' }, 'Free key from themoviedb.org → Settings → API.'),
      field('API key', keyInput),
      h('button', {
        class: 'btn primary focusable',
        onclick: function () { Store.setTmdbKey(keyInput.value); App.toast('TMDB key saved'); }
      }, 'Save key')
    ]));

    // Servers
    var servers = Store.get().servers;
    var list = h('div', { class: 'server-list' }, servers.length ? servers.map(function (s) {
      return h('div', { class: 'server' }, [
        h('div', {}, [
          h('strong', {}, s.name),
          h('div', { class: 'muted' }, s.type + ' · ' + s.url + ' · ' + s.username)
        ]),
        h('button', {
          class: 'btn small focusable',
          onclick: function () { Store.removeServer(s.id); App.go('settings', {}, true); App.toast('Server removed'); }
        }, 'Remove')
      ]);
    }) : h('p', { class: 'muted' }, 'No servers yet.'));

    var addArea = h('div', { class: 'add-area' });
    var typeButtons = Providers.types().map(function (type) {
      return h('button', {
        class: 'btn focusable',
        onclick: function () { showForm(type); }
      }, '+ Add ' + Providers.get(type).label);
    }).concat(Providers.comingSoon.map(function (name) {
      return h('button', { class: 'btn', disabled: true }, name + ' (soon)');
    }));

    page.appendChild(h('div', { class: 'panel' }, [
      h('h2', {}, 'Media servers'),
      h('p', { class: 'muted' }, 'Titles found on your servers play from there; everything else plays a placeholder clip.'),
      list,
      h('div', { class: 'actions' }, typeButtons),
      addArea
    ]));

    function showForm(type) {
      var provider = Providers.get(type);
      var inputs = {};
      var status = h('p', { class: 'muted' });
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
            status.textContent = 'Failed: ' + err.message +
              (err instanceof TypeError ? ' (server unreachable, wrong address, or blocked by CORS/HTTPS)' : '');
          });
        }
      }, 'Connect');
      addArea.appendChild(h('div', { class: 'panel inner' }, [h('h3', {}, 'Add ' + provider.label), form, connectBtn, status]));
      Nav.focusFirst(form);
    }

    Nav.focusFirst(page);
  }

  return { home: home, details: details, search: search, settings: settings };
})();
