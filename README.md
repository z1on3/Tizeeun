# Tizeeun

Movie and series browser for Samsung TVs, packaged as a [TizenBrew](https://github.com/reisxd/TizenBrew) app module.

- **Catalog:** [TMDB](https://www.themoviedb.org/) (trending, popular, top rated, search, details)
- **Playback:** your own media servers. Jellyfin works now; Plex and Emby are planned. Titles not found on any server play a placeholder clip.
- **Input:** made for the TV remote (arrow-key spatial navigation, Back key, media keys)

## Layout

```
package.json              TizenBrew module manifest (packageType "app")
app/index.html            entry point (appPath)
app/css/app.css           1920x1080 TV layout
app/js/storage.js         settings + servers in localStorage
app/js/tmdb.js            TMDB client (v3 key or v4 token)
app/js/providers/         media-server providers + registry
app/js/nav.js             remote-control spatial navigation
app/js/player.js          fullscreen HTML5 player
app/js/views.js           Home / Details / Search / Settings
app/js/main.js            router, Back handling, play flow
dev/mock-jellyfin.js      fake Jellyfin server for local testing
```

## Run locally

```bash
npm run dev                 # serves app/ on http://localhost:8080
node dev/mock-jellyfin.js   # optional: fake Jellyfin on :8096, login demo / demo
```

Open the app in a browser at 1920x1080 and use the arrow keys, Enter, and Esc (as Back).

## Install on the TV

1. `npm publish` (choose a unique package name in `package.json` first).
2. In TizenBrew on the TV, open the module manager and add the npm package name.
3. In the app: Settings → paste your TMDB API key → add your Jellyfin server.

## Adding a provider (Plex, Emby, …)

Create `app/js/providers/<name>.js` with the same interface as `jellyfin.js`:

| Member | Purpose |
|---|---|
| `type`, `label`, `fields` | Identity and the fields shown on the "Add server" form |
| `connect(form)` | Log in; resolves to the server object saved in settings |
| `libraryRows(server)` | Home rows (`{ title, load() }`) |
| `sourceForLocal(server, item)` | Play an item that came from this server's library |
| `findSource(server, item)` | Find a TMDB title on this server; resolve `null` if missing |

Then register it in `providers/index.js` and add a `<script>` tag in `index.html`.

## Known limitations / next steps

- **HTTP servers vs. HTTPS origin:** if TizenBrew serves the module over HTTPS, a LAN Jellyfin at `http://…` may be blocked as mixed content. If that happens on the TV, add a `serviceFile` proxy or use HTTPS on the server.
- **Codecs:** playback uses `<video>` with Jellyfin direct streams. Files the TV can't decode will fail. Next step: Samsung `webapis.avplay` and/or Jellyfin HLS transcoding (`master.m3u8`).
- Watch progress isn't reported back to Jellyfin yet (resume position is read, not written).
- No episode picker for series yet; "Play" starts next-up or the first episode.
