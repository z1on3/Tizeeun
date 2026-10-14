# Tizeeun

Movie and series browser for Samsung TVs, packaged as a [TizenBrew](https://github.com/reisxd/TizenBrew) app module. It acts as a **streaming aggregator**: for any title you search or open, it lists every source you can play it from — your own media servers, plus [frameXTV](https://framextv.xyz) online streams — and lets you pick one.

- **Catalog:** [TMDB](https://www.themoviedb.org/) (trending, popular, top rated, search, details)
- **Playback:** your own media servers (Jellyfin works now; Plex and Emby planned) **plus** frameXTV — a built-in, no-login online aggregator that supplies HLS mirrors for any TMDB title.
- **Aggregation:** the Details page groups sources as **Your servers / Online (frameXTV) / Fallback**. HLS is played with bundled [hls.js](https://github.com/video-dev/hls.js) and auto-fails-over across mirrors.
- **Input:** made for the TV remote (arrow-key spatial navigation, Back key, media keys)

Taking over the project? Start with [doc/HANDOVER.md](doc/HANDOVER.md).

## Layout

```
package.json              TizenBrew module manifest (packageType "app")
app/index.html            entry point (appPath)
app/css/app.css           1920x1080 TV layout ("projector light" theme)
app/fonts/                Bricolage Grotesque, Manrope, JetBrains Mono (OFL), bundled
app/js/config.js          TMDB key + API base (generated from .env by dev/build-config.js)
app/js/storage.js         media servers in localStorage
app/js/tmdb.js            TMDB client (v3 key or v4 token)
app/js/providers/         media-server providers + frameXTV online aggregator + registry
app/js/vendor/hls.min.js  bundled hls.js (plays frameXTV .m3u8 streams)
app/js/nav.js             remote-control spatial navigation
app/js/player.js          fullscreen HTML5 player (native MP4 + HLS via hls.js, mirror failover)
app/js/views.js           Home / Browse / Details (source aggregator) / Search / Settings
app/js/main.js            router, Back handling, play flow
dev/build-config.js       .env -> app/js/config.js (TMDB key)
dev/mock-jellyfin.js      fake Jellyfin server for local testing
dev/test-sources.js       provider/aggregation test (live frameXTV + mock Jellyfin)
```

## TMDB key

The catalog key is built in: put it in `.env` at the project root, then run the build to bake it into `app/js/config.js`:

```bash
TMDB_READ_TOKEN=...   # v4 read access token (preferred) — sent as a Bearer header
TMDB_API_KEY=...      # v3 API key (fallback) — sent as a query param
TMDB_BASE=...         # optional: override the API base URL (e.g. a proxy)
```

```bash
npm run config        # node dev/build-config.js  → writes app/js/config.js
```

`npm run dev` does this automatically via a `predev` hook, so the key is always up to date. `.env` is git-ignored; `app/js/config.js` is committed so the TV build has the key.

Anything in `config.js` ships to every TV and is publicly readable in the npm package. To keep the key private, run a small proxy (e.g. a Cloudflare Worker) that forwards to `api.themoviedb.org/3` and adds the key itself. Then set `TMDB_BASE` to the proxy URL in `.env` and leave both tokens empty: any non-default base is treated as configured.

## Run locally

Put the TMDB key in `.env` (see [TMDB key](#tmdb-key)).

```bash
npm run dev                 # regenerates config.js from .env, then serves app/ on http://localhost:8080
node dev/mock-jellyfin.js   # optional: fake Jellyfin on :8096, login demo / demo
```

Open the app in a browser at 1920x1080 and use the arrow keys, Enter, and Esc (as Back).

## Install on the TV

1. `npm publish` (choose a unique package name in `package.json` first).
2. In TizenBrew on the TV, open the module manager and add the npm package name.
3. frameXTV online streams work immediately — no setup. To add your own media server: Settings → add your Jellyfin.

Before publishing, put the TMDB key in `.env` and run `npm run config` so `app/js/config.js` (which ships in the package) has it.

## Adding a provider (Plex, Emby, …)

Create `app/js/providers/<name>.js` with the same interface as `jellyfin.js`:

| Member | Purpose |
|---|---|
| `type`, `label`, `fields` | Identity and the fields shown on the "Add server" form |
| `connect(form)` | Log in; resolves to the server object saved in settings |
| `libraryRows(server)` | Home rows (`{ title, load() }`) |
| `sourceForLocal(server, item)` | Play an item that came from this server's library |
| `findSource(server, item)` | Find a TMDB title on this server; resolve `null` if missing |

Then register it in `providers/index.js` and add a `<script>` tag in `index.html`. Any server with the same members is automatically picked up by the aggregation below.

## How source aggregation works

`Providers.sources(item)` (in `providers/index.js`) builds the list shown on the Details page, in three groups:

1. **Your servers** — one entry per connected server that has the title (the server's own copy via `sourceForLocal` when the item came from that library, otherwise the matched copy via `findSource`). Servers without the title are skipped.
2. **Online (frameXTV)** — frameXTV's extraction catalog is queried for the TMDB id; each extraction provider (Super Barbarian, Bowler, Miner, …) that has the title becomes one row, carrying its list of HLS mirrors. This needs no login — `api.framextv.tech` is public and CORS-open.
3. **Fallback** — the placeholder demo clip, always present so there's always something to play.

The Details page renders each group under a section label; pressing a row plays that source via `App.playSource`. A frameXTV row starts its best mirror and, if it fails, the player retries the sibling mirrors automatically. The primary **Play** button calls `Providers.resolve(item)`, which picks the first your-server copy, else the first online mirror (with its mirrors queued as fallback), else the placeholder — so a one-tap "just play it" path still works alongside the picker.

## Known limitations / next steps

- **frameXTV is a third-party dependency.** `api.framextv.tech` is closed-source and its per-provider endpoints are intermittent, so it may change or go down. Each per-provider request is time-boxed (12 s), and if they all come back empty an auto call (frameXTV picks a server) is used as a safety net — a title then only drops out of the "Online" group if even that fails. Remove `framextv` from the `Providers` registry in `providers/index.js` to switch it off entirely.
- **HTTP servers vs. HTTPS origin:** if TizenBrew serves the module over HTTPS, a LAN Jellyfin at `http://…` may be blocked as mixed content. If that happens on the TV, add a `serviceFile` proxy or use HTTPS on the server.
- **Codecs:** frameXTV streams are HLS and play via hls.js. Your own Jellyfin copies still use `<video>` with the direct file, so files the TV can't decode will fail. Next step: Samsung `webapis.avplay` and/or Jellyfin HLS transcoding (`master.m3u8`).
- Watch progress isn't reported back to Jellyfin yet (resume position is read, not written).
- Episode picker for series is in (Details page: season chips + episode list; picking re-fetches that episode's sources). "Play" still defaults to S1E1 when no episode is chosen.
- Subtitles (DOWN) and audio tracks (UP) are switched in the player from frameXTV's data; availability is best-effort — some titles have many, others none, and they load a moment after playback starts.
