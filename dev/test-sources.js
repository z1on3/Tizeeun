// Load the real app provider files in Node and verify the aggregator:
//   - Providers.sources(item) returns { sections: [ {title, entries:[...]} ] }
//     with "Your servers", "Online" (frameXTV), and "Fallback" groups.
//   - Providers.resolve(item) picks the best single source.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'app');
const NATIVE_FETCH = fetch;
const serverObj = { id: 'srv1', type: 'jellyfin', name: 'Mock Jellyfin', url: 'http://localhost:8096', token: 'mock-token', userId: 'u1', username: 'demo' };

global.window = global;
global.localStorage = { _d: {}, getItem(k){ return this._d[k] || null; }, setItem(k,v){ this._d[k]=v; } };
global.navigator = { userAgent: 'node' };
global.fetch = (url, opts) => NATIVE_FETCH(url, opts);
global.Config = { tmdbKey: '', tmdbBase: 'https://api.themoviedb.org/3' };
global.Store = {
  get: function () { return { servers: [serverObj], deviceId: 'dev1' }; },
  addServer: function (s) { s.id = 'x'; return s; },
  removeServer: function () {}
};
global.document = { getElementById: function(){ return null; }, querySelectorAll: function(){ return []; }, createElement: function(){ return { style:{}, classList:{add(){},remove(){},toggle(){}}, setAttribute(){}, appendChild(){}, addEventListener(){}, removeAttribute(){} }; }, addEventListener: function(){}, body: { contains: function(){ return true; } } };

function load(rel, name) {
  vm.runInThisContext(fs.readFileSync(path.join(APP, rel), 'utf8'), { filename: name });
}

load('js/providers/placeholder.js', 'placeholder.js');
load('js/providers/jellyfin.js', 'jellyfin.js');
load('js/providers/framextv.js', 'framextv.js');
load('js/providers/index.js', 'index.js');

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok - ' + msg);
  else { failures++; console.log('  FAIL - ' + msg); }
}
function section(res, title) {
  return res.sections.filter(function (s) { return s.title === title; })[0];
}

const has = { tmdbId: 10378, type: 'movie', title: 'Big Buck Bunny', year: '2008' };
const local = { tmdbId: 10378, type: 'movie', title: 'Big Buck Bunny', year: '2008', local: { serverId: 'srv1', itemId: 'm1', kind: 'Movie' }, sourceLabel: 'Mock Jellyfin' };
const unknown = { tmdbId: 1, type: 'movie', title: 'Nope Film', year: '1999' };

(async function () {
  console.log('FrameXtvProvider registered + built-in:');
  assert(global.Providers.get('framextv') === global.FrameXtvProvider, 'framextv is in the registry');
  assert(global.Providers.types().indexOf('framextv') === -1, 'framextv is hidden from "Add server" types');
  assert(global.Providers.types().indexOf('jellyfin') !== -1, 'jellyfin is still an addable type');

  console.log('Providers.sources(has) — mock has it, frameXTV likely does not:');
  const res = await global.Providers.sources(has);
  const servers = section(res, 'Your servers');
  const online = section(res, 'Online');
  const fallback = section(res, 'Fallback');
  assert(servers && servers.entries.length === 1 && servers.entries[0].kind === 'server', 'one server entry (got ' + (servers && servers.entries.length) + ')');
  assert(online && online.entries.every(function (e) { return e.kind === 'online' && Array.isArray(e.mirrors) && e.mirrors.length > 0; }), 'online entries are frameXTV mirror groups (got ' + (online && online.entries.length) + ')');
  assert(fallback && fallback.entries.length === 1 && fallback.entries[0].kind === 'fallback', 'one fallback entry');

  console.log('Providers.sources(local) — own copy first, resume read:');
  const res2 = await global.Providers.sources(local);
  const localEntry = section(res2, 'Your servers').entries[0];
  assert(localEntry.isLocal === true, 'own library entry flagged isLocal');
  assert(localEntry.source.startSeconds === 30, 'resume position read (startSeconds=' + localEntry.source.startSeconds + ')');

  console.log('Providers.sources(unknown) — no server copy, placeholder present:');
  const res3 = await global.Providers.sources(unknown);
  assert(section(res3, 'Your servers').entries.length === 0, 'no server copy for unknown title');
  assert(section(res3, 'Fallback').entries.length === 1, 'placeholder still offered');

  console.log('Providers.resolve(has) === server source:');
  const pick = await global.Providers.resolve(has);
  assert(pick.url === section(res, 'Your servers').entries[0].source.url, 'resolve prefers the user server');

  console.log('Providers.resolve(unknown) === online (if any) else placeholder:');
  const pick2 = await global.Providers.resolve(unknown);
  const onlinePick = section(res3, 'Online').entries.length ? section(res3, 'Online').entries[0] : null;
  if (onlinePick) assert(pick2.url === onlinePick.mirrors[0].url && pick2.fallback.length === onlinePick.mirrors.length - 1, 'resolve picks first online mirror with fallback list');
  else assert(pick2.url === section(res3, 'Fallback').entries[0].source.url, 'resolve falls back to placeholder when no online source');

  console.log('frameXTV onlineSource shape:');
  if (onlinePick) {
    const os = global.Providers.onlineSource(unknown, onlinePick);
    assert(/^https?:\/\//.test(os.url) && os.type === 'hls', 'onlineSource has an http url + hls type');
    assert(Array.isArray(os.fallback), 'onlineSource has a fallback mirror array');
  }

  console.log(failures === 0 ? '\nALL PASSED' : '\n' + failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(function (e) { console.error('error', e); process.exit(1); });
