// Verify Providers.sources streams entries in progressively (onUpdate called
// multiple times, entries visible before state.done), and that the final settled
// shape is unchanged.
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

const inception = { tmdbId: 27205, type: 'movie', title: 'Inception', year: '2010', imdbId: 'tt1375666' };

(async function () {
  const updates = [];
  let firstEntrySeenAt = null; // update index when the very first entry appeared
  const final = await global.Providers.sources(inception, function (sections, state) {
    updates.push({
      serverCount: sections[0].entries.length,
      onlineCount: sections[1].entries.length,
      fallbackCount: sections[2].entries.length,
      onlineProviders: sections[1].entries.map(function (e) { return e.providerName; }),
      done: state.done
    });
    var total = sections[0].entries.length + sections[1].entries.length + sections[2].entries.length;
    if (firstEntrySeenAt === null && total > 0) firstEntrySeenAt = updates.length - 1;
  });

  console.log('total progressive updates emitted:', updates.length);
  // 1) It must have streamed (more than one update) — not a single final blob.
  assert(updates.length > 1, 'onUpdate fired multiple times (progressive), got ' + updates.length);

  // 2) The final settled state must have done === true.
  assert(updates[updates.length - 1].done === true, 'last update has done=true');

  // 3) Some entries were visible BEFORE the final done update (that's the point).
  var beforeDone = updates.slice(0, updates.length - 1);
  var anyBefore = beforeDone.some(function (u) { return u.serverCount + u.onlineCount + u.fallbackCount > 0; });
  assert(anyBefore, 'at least one source was visible before everything settled');

  // 4) No entry was ever double-counted (monotonic growth, or stable at end).
  var prev = 0, monotonicallyNonDecreasing = true;
  updates.forEach(function (u) {
    var tot = u.serverCount + u.onlineCount + u.fallbackCount;
    if (tot < prev) monotonicallyNonDecreasing = false;
    prev = tot;
  });
  assert(monotonicallyNonDecreasing, 'source counts only grew (no removals between emits)');

  // 5) Final shape: Inception should have online rows (frameXTV + VidSrc + 2Embed) and a fallback.
  const sec = final.sections;
  console.log('  final: servers=' + sec[0].entries.length + ' online=[' + sec[1].entries.map(function (e) { return e.providerName; }).join(', ') + '] fallback=' + sec[2].entries.length);
  assert(sec[1].entries.some(function (e) { return e.providerName === 'VidSrc'; }), 'VidSrc iframe row present in final');
  assert(sec[1].entries.some(function (e) { return e.providerName === '2Embed'; }), '2Embed iframe row present in final');
  assert(sec[1].entries.some(function (e) { return e.mirrors[0].type !== 'iframe'; }), 'a direct-HLS frameXTV row present in final');
  assert(sec[2].entries.length === 1, 'placeholder fallback present');

  // 6) resolve() still works off the settled promise.
  const pick = await global.Providers.resolve(inception);
  assert(pick && /^https?:\/\//.test(pick.url), 'resolve() returns a playable url');

  console.log(failures === 0 ? '\nALL PASSED' : '\n' + failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(function (e) { console.error('error', e); process.exit(1); });
