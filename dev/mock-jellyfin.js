// Minimal mock of the Jellyfin endpoints Tizeeun uses, for testing without a real server.
// Run: node dev/mock-jellyfin.js  → http://localhost:8096  (login: demo / demo)
const http = require('http');

const PORT = Number(process.env.PORT) || 8096;
const TOKEN = 'mock-token';
const USER = { Id: 'u1', Name: 'demo' };
const DEMO_VIDEO = 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4';

const items = [
  { Id: 'm1', Name: 'Big Buck Bunny', Type: 'Movie', ProductionYear: 2008, ProviderIds: { Tmdb: '10378' }, Genres: ['Animation', 'Comedy'],
    Overview: 'A giant rabbit takes revenge on three bullying rodents.', CommunityRating: 6.4,
    UserData: { PlaybackPositionTicks: 300000000 } },
  { Id: 'm2', Name: 'Sintel', Type: 'Movie', ProductionYear: 2010, ProviderIds: { Tmdb: '45745' }, Genres: ['Animation', 'Fantasy'],
    Overview: 'A lonely young woman searches for her baby dragon.', CommunityRating: 7.1, UserData: {} },
  { Id: 's1', Name: 'Demo Series', Type: 'Series', ProductionYear: 2020, ProviderIds: { Tmdb: '999' }, Genres: ['Drama'],
    Overview: 'A series used to test episode resolution.', UserData: {} }
];
const episode = { Id: 'e1', Name: 'Pilot', Type: 'Episode', SeriesId: 's1', SeriesName: 'Demo Series',
  ParentIndexNumber: 1, IndexNumber: 1, UserData: {} };
const byId = Object.fromEntries([...items, episode].map((i) => [i.Id, i]));

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function authed(req, url) {
  const header = req.headers.authorization || '';
  return header.includes('Token="' + TOKEN + '"') || url.searchParams.get('ApiKey') === TOKEN;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  console.log(req.method, req.url);

  if (req.method === 'OPTIONS') return send(res, 204);
  if (p === '/System/Info/Public') return send(res, 200, { ServerName: 'Mock Jellyfin', Version: '10.10.0' });

  if (p === '/Users/AuthenticateByName' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (body.Username === 'demo' && body.Pw === 'demo') send(res, 200, { AccessToken: TOKEN, User: USER });
      else send(res, 401, { error: 'bad credentials' });
    });
    return;
  }

  if (p.startsWith('/Items/') && p.includes('/Images/')) return send(res, 404);

  if (!authed(req, url)) return send(res, 401, { error: 'unauthorized' });

  if (p.startsWith('/Videos/')) {
    res.writeHead(302, { Location: DEMO_VIDEO, 'Access-Control-Allow-Origin': '*' });
    return res.end();
  }
  if (p === '/Users/u1/Items/Resume') return send(res, 200, { Items: [items[0]] });
  if (p === '/Users/u1/Items/Latest') return send(res, 200, items);
  if (p === '/Users/u1/Items') {
    const term = (url.searchParams.get('searchTerm') || '').toLowerCase();
    const types = (url.searchParams.get('IncludeItemTypes') || '').split(',');
    const genre = url.searchParams.get('Genres');
    const sortKey = (url.searchParams.get('SortBy') || '').split(',')[0];
    const found = items
      .filter((i) => i.Name.toLowerCase().includes(term) && types.includes(i.Type))
      .filter((i) => !genre || (i.Genres || []).includes(genre))
      .sort((a, b) => sortKey === 'CommunityRating' ? (b.CommunityRating || 0) - (a.CommunityRating || 0)
        : sortKey === 'PremiereDate' ? b.ProductionYear - a.ProductionYear : 0);
    return send(res, 200, { Items: found });
  }
  const one = p.match(/^\/Users\/u1\/Items\/(\w+)$/);
  if (one) return byId[one[1]] ? send(res, 200, byId[one[1]]) : send(res, 404);
  if (p === '/Shows/NextUp') return send(res, 200, { Items: [episode] });
  if (/^\/Shows\/\w+\/Episodes$/.test(p)) return send(res, 200, { Items: [episode] });

  send(res, 404, { error: 'not mocked: ' + p });
}).listen(PORT, () => console.log('Mock Jellyfin on http://localhost:' + PORT + '  (login demo/demo)'));
