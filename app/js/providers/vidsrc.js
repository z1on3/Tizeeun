// VidSrc iframe provider. VidSrc renders a third-party player in an iframe —
// we can't control subs/audio from here, but it's a solid fallback when
// frameXTV (direct HLS) doesn't have the title.
//
// URL patterns (verified live 2026-10-15):
//   movie:  https://vidsrc.sh/embed/movie/{imdbId}
//   tv:     https://vidsrc.sh/embed/tv/{imdbId}/{season}/{episode}
//
// The item needs an `imdbId`; if it's missing (a search result before details
// loads) this resolves to []. Contract: findSource returns an ARRAY of sources
// (here, at most one iframe source), matching frameXTV.
//
// No HEAD check: VidSrc returns 200 for all embed URLs (title not found is
// shown inside the iframe). We always offer the row; the user gets the
// embedded player's own "not available" message if the title isn't there.
var VidSrcProvider = (function () {
  var BASE = 'https://vidsrc.sh';

  function buildUrl(item) {
    var imdb = item.imdbId;
    if (!imdb) return null;
    if (item.type === 'tv') {
      return BASE + '/embed/tv/' + imdb + '/' + (item.season || 1) + '/' + (item.episode || 1);
    }
    return BASE + '/embed/movie/' + imdb;
  }

  // Resolves to an array with one iframe source, or [] when no imdbId.
  function findSource(server, item) {
    var url = item ? buildUrl(item) : null;
    if (!url) return Promise.resolve([]);
    return Promise.resolve([{
      url: url,
      title: item.title,
      note: 'VidSrc',
      startSeconds: 0,
      type: 'iframe',
      quality: '',
      providerName: 'VidSrc',
      serverName: 'VidSrc'
    }]);
  }

  return {
    type: 'vidsrc',
    label: 'VidSrc',
    builtIn: true,
    fields: [],
    connect: function () {
      return Promise.resolve({ type: 'vidsrc', name: 'VidSrc', url: BASE, token: '' });
    },
    libraryRows: function () { return []; },
    sourceForLocal: function () { return Promise.resolve(null); },
    findSource: findSource
  };
})();
