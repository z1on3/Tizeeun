// Persistent settings in localStorage: TMDB credentials and the user's media servers.
var Store = (function () {
  var KEY = 'tizeeun.settings.v1';

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var data = raw ? JSON.parse(raw) : {};
      return {
        tmdbKey: data.tmdbKey || '',
        servers: Array.isArray(data.servers) ? data.servers : [],
        deviceId: data.deviceId || newId()
      };
    } catch (e) {
      return { tmdbKey: '', servers: [], deviceId: newId() };
    }
  }

  function newId() {
    return 'tz-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  var state = load();
  save();

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  return {
    get: function () { return state; },
    setTmdbKey: function (key) {
      state.tmdbKey = (key || '').trim();
      save();
    },
    addServer: function (server) {
      server.id = newId();
      state.servers.push(server);
      save();
      return server;
    },
    removeServer: function (id) {
      state.servers = state.servers.filter(function (s) { return s.id !== id; });
      save();
    }
  };
})();
