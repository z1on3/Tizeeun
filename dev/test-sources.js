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
load('js/providers/vidsrc.js', 'vidsrc.js');
load('js/providers/2embed.js', '2embed.js');
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
// Inception: real TMDB + IMDB id, so frameXTV (HLS) AND VidSrc/2Embed (iframe) all appear.
const inception = { tmdbId: 27205, type: 'movie', title: 'Inception', year: '2010', imdbId: 'tt1375666' };

(async function () {
  console.log('Built-in providers registered + hidden from "Add server":');
  assert(global.Providers.get('framextv') === global.FrameXtvProvider, 'framextv is in the registry');
  assert(global.Providers.get('vidsrc') === global.VidSrcProvider, 'vidsrc is in the registry');
  assert(global.Providers.get('2embed') === global.Embed2Provider, '2embed is in the registry');
  assert(global.Providers.types().indexOf('framextv') === -1 && global.Providers.types().indexOf('vidsrc') === -1 && global.Providers.types().indexOf('2embed') === -1, 'all built-ins hidden from "Add server" types');
  assert(global.Providers.types().indexOf('jellyfin') !== -1, 'jellyfin is still an addable type');

  console.log('Providers.sources(has) — mock has it, no imdbId (no iframe rows):');
  const res = await global.Providers.sources(has);
  const servers = section(res, 'Your servers');
  const online = section(res, 'Online');
  const fallback = section(res, 'Fallback');
  assert(servers && servers.entries.length === 1 && servers.entries[0].kind === 'server', 'one server entry (got ' + (servers && servers.entries.length) + ')');
  assert(online && online.entries.every(function (e) { return e.kind === 'online' && Array.isArray(e.mirrors) && e.mirrors.length > 0; }), 'online entries are mirror groups (got ' + (online && online.entries.length) + ')');
  assert(online && online.entries.every(function (e) { return e.providerName !== 'VidSrc' && e.providerName !== '2Embed'; }), 'no iframe rows without imdbId');
  assert(fallback && fallback.entries.length === 1 && fallback.entries[0].kind === 'fallback', 'one fallback entry');

  console.log('Providers.sources(inception) — frameXTV direct (HLS/MP4) + VidSrc + 2Embed iframe:');
  const resIn = await global.Providers.sources(inception);
  const onlineIn = section(resIn, 'Online').entries;
  const vidsrcIn = onlineIn.filter(function (e) { return e.providerName === 'VidSrc'; });
  const embed2In = onlineIn.filter(function (e) { return e.providerName === '2Embed'; });
  const directIn = onlineIn.filter(function (e) { return e.mirrors[0].type !== 'iframe'; });
  assert(vidsrcIn.length === 1 && vidsrcIn[0].mirrors[0].type === 'iframe' && /tt1375666/.test(vidsrcIn[0].mirrors[0].url), 'VidSrc iframe row present with IMDB url (got ' + (vidsrcIn[0] && vidsrcIn[0].mirrors[0].url) + ')');
  assert(embed2In.length === 1 && embed2In[0].mirrors[0].type === 'iframe' && /tt1375666/.test(embed2In[0].mirrors[0].url), '2Embed iframe row present with IMDB url (got ' + (embed2In[0] && embed2In[0].mirrors[0].url) + ')');
  assert(directIn.length >= 1, 'a direct frameXTV source present (got ' + directIn.length + ': ' + directIn.map(function (e) { return e.mirrors[0].type; }).join(',') + ')');

  console.log('Providers.onlineSource(inception) — direct vs iframe shaping:');
  const directEntry = directIn[0];
  const directSrc = global.Providers.onlineSource(inception, directEntry);
  assert(directSrc.type === (directEntry.mirrors[0].type || 'hls') && Array.isArray(directSrc.fallback) && directSrc.fallback.length === directEntry.mirrors.length - 1, 'direct source keeps its type (' + directSrc.type + ') + fallback mirrors');
  const iframeSrc = global.Providers.onlineSource(inception, vidsrcIn[0]);
  assert(iframeSrc.type === 'iframe' && !iframeSrc.fallback, 'iframe source has iframe type, no fallback list');

  console.log('Providers.resolve(inception) — prefers a direct source over iframe:');
  const pickIn = await global.Providers.resolve(inception);
  assert(pickIn.type !== 'iframe', 'resolve returns a direct source (got ' + pickIn.type + '), not the iframe');

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

  console.log(failures === 0 ? '\nALL PASSED' : '\n' + failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(function (e) { console.error('error', e); process.exit(1); });
