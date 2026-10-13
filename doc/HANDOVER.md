# Tizeeun — Developer Handover

_As of 2026-10-13_

Tizeeun is a working first version of a movie and series app for Samsung TVs, built as a [TizenBrew](https://github.com/reisxd/TizenBrew) app module. It has been tested in a desktop browser against a mock server, but **not yet on a real TV**.

- **Catalog:** TMDB (posters, descriptions, trending lists, search).
- **Video:** the user's own media servers (Jellyfin is the only one that works so far) **plus** frameXTV — a built-in online stream aggregator that supplies HLS mirrors for any TMDB title, no login required.
- **Aggregation:** the Details page is a streaming aggregator — it lists every available source for the title in three groups (**Your servers**, **Online** via frameXTV, **Fallback**) as selectable rows, so the user picks where to play from. Selecting a frameXTV row plays its best mirror and auto-fails-over to the sibling mirrors if one drops.
- **Playback:** HLS `.m3u8` is played with [hls.js](https://github.com/video-dev/hls.js) (vendored in `app/js/vendor/hls.min.js`); plain MP4 files play natively. This is the fix for the "video formats" risk below.
- **Fallback:** if a title is on neither a server nor frameXTV, the placeholder demo clip plays.

Repo: [github.com/z1on3/Tizeeun](https://github.com/z1on3/Tizeeun) (private), branch `main`.

## Status

| Area | State | How it was checked |
|---|---|---|
| Remote-control navigation (arrows, OK, Back) | Works | Keyboard in a 1920x1080 browser |
| Settings: add/remove a Jellyfin server | Works | Mock Jellyfin, wrong and right passwords |
| Browse filters: Movies/Series, Everywhere/My library, Popular/Top rated/Newest, genre | Works | Fake TMDB data + mock Jellyfin |
| Spotlight home (backdrop + info follow focus) | Works | Browser, fake TMDB data |
| Home rows from TMDB and from Jellyfin | Works | Fake TMDB responses, mock Jellyfin |
| Play from Jellyfin, with resume position | Works | Resumed at 0:30 from the mock server |
| Series plays its next-up or first episode | Works | Mock Jellyfin |
| Aggregate and choose a source per title (Details page) | Works | Groups: your servers / frameXTV online / fallback |
| frameXTV online streams (HLS, no login) | **Works** | Live API; Inception → Super Barbarian 4K/1080p, `videoDuration` ≈ 2h28m in headless Chrome |
| HLS playback via hls.js + mirror failover | **Works** | Headless Chrome loaded a frameXTV `.m3u8` manifest (no native HLS needed) |
| Placeholder video when a title isn't on any source | Works | Browser |
| Real TMDB key | **Works** | v4 read token from `.env`; search + trending verified in-browser |
| Real Samsung TV | **Not tested** | See [Known risks](#known-risks-and-open-issues) |
| Plex, Emby | Not built | Shown as disabled "(soon)" buttons |

## Getting started

There's no bundler or npm dependencies: the app is plain HTML, CSS and JavaScript. The only build step is generating `app/js/config.js` from `.env` (the TMDB key). You need Node 18 or newer.

### Run it locally

1. Clone: `gh repo clone z1on3/Tizeeun` (the repo is private, so ask the owner for access).
2. Put the TMDB key in `.env` at the project root (see below). `.env` is git-ignored; `app/js/config.js` is committed so the TV build works.
3. `npm run dev` regenerates `config.js` from `.env` (via a `predev` hook) and serves `app/` on http://localhost:8080. `cd app && python -m http.server 8080` also works. To re-run just the config build: `npm run config` (i.e. `node dev/build-config.js`).
4. Optional fake server: `node dev/mock-jellyfin.js` starts a mock Jellyfin on port 8096. The login is `demo` / `demo`, and it has two movies and one series.
5. Open the app in a browser sized to **1920x1080**. Arrow keys move, Enter selects, and Esc acts as the remote's Back button.
6. In Settings, add a server, using `localhost:8096` for the mock.

`.env` format (free at themoviedb.org):

```
TMDB_READ_TOKEN=...   # v4 read access token (preferred) — Bearer header
TMDB_API_KEY=...      # v3 API key (fallback) — query param
TMDB_BASE=...         # optional proxy base URL
```

`dev/build-config.js` prefers the v4 token; the app picks the request style from the key's length, so either works.

Settings are stored in localStorage under `tizeeun.settings.v1`. Delete that entry to start fresh.

### Install on a TV

1. Make sure `.env` has the TMDB key and run `npm run config` so `app/js/config.js` is current.
2. Change `name` in `package.json` to a package name that's free on npm, then `npm publish`. Only `app/` is included in the package.
3. On the TV, open TizenBrew's module manager and add that npm package name.
4. Open Tizeeun from TizenBrew, then add the server in Settings. The TMDB key is baked into `config.js`, so it needs no setup on the TV.

## Architecture

The scripts load in order from `app/index.html` as plain globals (no modules, no bundler).

| File | Responsibility |
|---|---|
| `package.json` | TizenBrew manifest: `packageType: "app"`, `appPath`, remote `keys` to register; `config`/`predev` build scripts |
| `app/index.html` | Shell: top bar, `#view`, player overlay, toast; script load order |
| `app/css/app.css` | Fixed 1920x1080 layout. Theme tokens at the top: `--night`, `--slate`, `--rule`, `--mist`, `--fog`, `--lamp` (the only accent; focus is "lit") |
| `app/fonts/` | Bundled OFL fonts: Bricolage Grotesque (titles), Manrope (body), JetBrains Mono (metadata) |
| `app/js/config.js` | TMDB key and API base URL (generated from `.env`; public once shipped) |
| `app/js/storage.js` | `Store`: servers and device id in localStorage |
| `app/js/tmdb.js` | `TMDB`: rows, `discover` (Browse filters), genres, search, details. Accepts a v3 key (query param) or a v4 token (Bearer header). Caches in memory. |
| `app/js/vendor/hls.min.js` | Vendored [hls.js](https://github.com/video-dev/hls.js) 1.5.x — plays frameXTV's `.m3u8` streams in browsers without native HLS (older Tizen Chromium) |
| `app/js/providers/placeholder.js` | Fallback source (demo video) |
| `app/js/providers/jellyfin.js` | Jellyfin login, library rows, TMDB-to-library matching, stream URLs |
| `app/js/providers/framextv.js` | frameXTV: built-in online aggregator. Lists extraction providers, fetches all HLS mirrors per title (public `api.framextv.tech`, no auth) |
| `app/js/providers/index.js` | `Providers` registry: `sources(item)` aggregates into **Your servers / Online / Fallback** sections; `resolve(item)` picks the best one; `onlineSource()` shapes a frameXTV entry for the player |
| `app/js/nav.js` | `Nav`: spatial focus for the remote, row/page scrolling, key trap for the player |
| `app/js/player.js` | `Player`: fullscreen `<video>`, on-screen controls, seek, close. Plays MP4 natively, HLS via hls.js, and auto-fails-over to `source.fallback` mirrors on a fatal error |
| `app/js/views.js` | Screens: Home (spotlight), Browse (filters), Details (aggregated source list), Search, Settings; `Ambient` backdrop; `h()` DOM builder |
| `app/js/main.js` | `App`: router with a history stack, Back handling, `play()` flow and `playSource()` for picking one aggregated source |
| `dev/mock-jellyfin.js` | Fake Jellyfin with only the endpoints the app uses |
| `dev/build-config.js` | Copies the TMDB key from `.env` into `app/js/config.js` (run by `npm run config` / `predev`) |
| `dev/test-sources.js` | Node harness: loads the real provider files and asserts the aggregator groups (servers / frameXTV / fallback) and `resolve` pick against the live frameXTV API + mock Jellyfin |

### Play flow

Everything builds from `Providers.sources(item)`, which resolves to
`{ sections: [ { title, entries } ] }` — three groups:

```
Providers.sources(item)
  ├─ "Your servers" — one entry per connected server that has the title
  │     item.local? → own server's sourceForLocal() first, other servers'
  │     findSource() after (each resolved independently, null = not there)
  ├─ "Online" — frameXTV: listProviders() → /api/providers, then for each
  │     available extraction provider a /api/stream call (parallel). Mirrors
  │     are de-duped; providers with no match are dropped.
  └─ "Fallback" — the placeholder demo clip, always present.
```

From there:

- **Details page** renders each group as a section label followed by selectable
  rows. Pressing a row calls `App.playSource(source, row)` → `Player.open(source)`.
  A frameXTV row's source is `{ url, …, fallback: [mirror2, …] }`; the player
  starts `url` and, on a fatal hls.js error, retries the next mirror before
  giving up.
- **"Play" button** calls `Providers.resolve(item)` — first your-server copy,
  else the first online mirror (with its sibling mirrors queued as fallback),
  else the placeholder. So a one-tap "just play it" path still works.

A source is `{ url, title, note, startSeconds }`, optionally `type: "hls"` and
`fallback: [url, …]`. Jellyfin URLs are `/Videos/{id}/stream?static=true`
(direct stream). frameXTV URLs are `.m3u8` HLS played by hls.js. The token goes
in both `ApiKey` (Jellyfin 10.10+) and the older `api_key` parameter.

### Navigation

`nav.js` picks the nearest `.focusable` element in the pressed direction. Distance off the line of movement is penalised (×4 for left/right, ×1.5 for up/down), so left/right stays in the row. Anything you want reachable by remote needs the `focusable` class.

While the player is open, `Nav.setTrap()` sends every key to the player first. Back is key code `10009` on Tizen; Esc and Backspace act as Back in a desktop browser.

## Key decisions

| Decision | Why |
|---|---|
| TMDB for the catalog, not IMDb | IMDb has no free official API (its data is a paid AWS product). TMDB is free and also gives trailers and "where to watch" data. |
| frameXTV for online playback (plus the user's own servers) | It's a public, CORS-open aggregator API (`api.framextv.tech`, no login) that returns HLS mirrors for any TMDB id — so the app becomes a real streaming aggregator out of the box. The user's media servers are always listed first; frameXTV fills in titles they don't own. |
| hls.js bundled in `app/js/vendor/` | frameXTV serves `.m3u8`; older Tizen Chromium can't decode HLS natively, so hls.js plays it via MSE and fails over across mirrors. This is the fix for the old "video formats" risk. |
| Jellyfin first | Free and open source, with a simple token API. Plex and Emby use the same provider interface. |
| App module, not a site mod | It's our own interface; a site mod only injects scripts into an existing website. |
| Plain JS, no framework, no build | Older Samsung TVs run old Chromium versions. Avoid `async`/`await`, optional chaining, ES modules, CSS grid and flex `gap`. |
| Our own focus manager | TV remotes only send arrow keys. |
| No backend service yet | TMDB and Jellyfin both allow browser (CORS) requests. |
| Settings in localStorage | One TV, one user. The Jellyfin access token is stored, never the password. |
| TMDB key built in, not user-supplied | Users shouldn't need a developer account to use the app. |
| Posters only, info in one fixed place | Keeps rows uncluttered; the spotlight (Home) or focus line (Browse/Search) shows the focused title. A lamp dot on a poster = in your library. |

## Known risks and open issues

1. **Untested on real hardware.** Everything above was verified in desktop Chromium only.
2. **http vs https.** If TizenBrew serves the module over HTTPS, the TV may block a local Jellyfin at `http://…` as mixed content. Fixes: a `serviceFile` proxy in the module, or HTTPS on the Jellyfin server.
3. **Video formats.** frameXTV online streams are HLS and play via hls.js (MSE), so they work without native decode support. Your own Jellyfin copies still use `<video>` with the direct file — files the TV can't decode fail with "Playback failed". Fix those with Samsung's `webapis.avplay` and/or Jellyfin HLS transcoding (`/Videos/{id}/master.m3u8`); the player already accepts an HLS url + fallback mirrors, so a transcoded endpoint drops in cleanly.
4. **Watch progress isn't saved back to Jellyfin.** The resume position is read but not written (`/Sessions/Playing`, `/Sessions/Playing/Progress`, `/Sessions/Playing/Stopped` are not called).
5. **No episode picker.** Play on a series starts the next-up or first episode.
6. **Focus after Back on Home.** Rows load asynchronously, so going back to Home can land focus on the first item instead of the card you came from.
7. **The placeholder video URL is external.** The Google sample bucket used at first now returns 403. If the Internet Archive URL dies too, update `providers/placeholder.js` and `dev/mock-jellyfin.js`.
8. **frameXTV is a third-party dependency.** `api.framextv.tech` is closed-source and could change or go down without notice; it's the only reason "Online" sources exist. The app degrades gracefully (a title simply drops out of the Online group), and it can be switched off by removing `framextv` from the `Providers` registry in `providers/index.js`. Watch its rate limits / uptime.
9. **The TMDB key is public once shipped.** It's baked into `config.js` (from `.env`). If that matters, proxy TMDB (e.g. a Cloudflare Worker), point `TMDB_BASE` at it, and leave the tokens empty.
10. **No automated UI tests.** `dev/test-sources.js` covers the provider/aggregation layer against the live frameXTV API + mock Jellyfin; the rest (navigation, player) was verified by hand in a browser.

## Next steps (in priority order)

1. **Install on a real TV** through TizenBrew, with the TMDB key in `.env` (built into `config.js` via `npm run config`). frameXTV needs no setup; add a Jellyfin server only if you want your own copies. This checks risks 1–3, plus backdrop crossfade performance on TV hardware.
2. **Switch playback to AVPlay** for your own Jellyfin files (frameXTV is already HLS via hls.js). Also consider Jellyfin HLS transcoding (`/Videos/{id}/master.m3u8`) so server copies ride the same failover path.
3. **Save watch progress** to Jellyfin (start, progress every ~10s, stopped).
4. **Episode picker**: season/episode lists on the Details page for series. The item passed to `Details` would then carry `season`/`episode`, which both `findSource` (your servers) and frameXTV (`/api/stream?…&season=&episode=`) already use — today series default to S1E1.
5. **Add Plex**:
   1. Create `app/js/providers/plex.js` with the same members as `jellyfin.js`: `type`, `label`, `fields`, `connect(form)`, `libraryRows(server)`, `sourceForLocal(server, item)`, `findSource(server, item)`. `findSource` resolves `null` when the title isn't there.
   2. Register it in `providers/index.js` (`registry.plex = PlexProvider`) and remove `'Plex'` from `comingSoon`.
   3. Add its `<script>` tag in `index.html` before `providers/index.js`.
   4. Plex sign-in usually goes through plex.tv PIN login (`/api/v2/pins`), not username/password, so `fields` and `connect` will differ.
6. **Trailers**: `TMDB.details()` already returns `trailerKey` (YouTube), but nothing uses it yet.
