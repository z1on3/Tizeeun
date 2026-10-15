// 2Embed iframe provider. Another classic embed service; its embed page
// explicitly requires the iframe to have NO sandbox attribute to play, so the
// player renders it sandbox-free (see player.js iframe mode). Fallback when
// frameXTV (direct HLS) and VidSrc don't have the title.
//
// URL patterns (verified live 2026-10-15):
//   movie:  https://2embed.cc/embed/{imdbId}
//   tv:     https://2embed.cc/embedtv/{imdbId}/{season}/{episode}
//
// No HEAD check: 2Embed returns 200 for all embed URLs (title not found is
// shown inside the iframe). We always offer the row when the title has an
// imdbId.
var Embed2Provider = (function () {
  var BASE = 'https://2embed.cc';

  function buildUrl(item) {
    var imdb = item.imdbId;
    if (!imdb) return null;
    if (item.type === 'tv') {
      return BASE + '/embedtv/' + imdb + '/' + (item.season || 1) + '/' + (item.episode || 1);
    }
    return BASE + '/embed/' + imdb;
  }

  // Resolves to an array with one iframe source, or [] when no imdbId.
  function findSource(server, item) {
    var url = item ? buildUrl(item) : null;
    if (!url) return Promise.resolve([]);
    return Promise.resolve([{
      url: url,
      title: item.title,
      note: '2Embed',
      startSeconds: 0,
      type: 'iframe',
      quality: '',
      providerName: '2Embed',
      serverName: '2Embed'
    }]);
  }

  return {
    type: '2embed',
    label: '2Embed',
    builtIn: true,
    fields: [],
    connect: function () {
      return Promise.resolve({ type: '2embed', name: '2Embed', url: BASE, token: '' });
    },
    libraryRows: function () { return []; },
    sourceForLocal: function () { return Promise.resolve(null); },
    findSource: findSource
  };
})();
