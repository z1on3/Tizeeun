// Fullscreen HTML5 video player driven by the remote.
//
// Plays both plain files (MP4, etc.) and HLS (.m3u8) streams. When the source
// is HLS and hls.js is available, playback goes through hls.js (MSE) — that's
// what older Tizen Chromium needs, since it can't decode HLS natively. A source
// may carry `fallback: [url, …]` sibling mirrors; on a fatal playback error the
// player advances to the next mirror before giving up.
//
// Subtitles: a frameXTV source carries `item` (tmdbId + type + season/episode);
// the player pulls the frameXTV subtitle list and attaches each as a real
// <track> (the native renderer draws them, which works better than MSE text
// tracks). DOWN cycles subtitle tracks, UP cycles audio tracks.
var Player = (function () {
  var root = document.getElementById('player');
  var video = document.getElementById('video');
  var osd = document.getElementById('player-osd');
  var titleEl = document.getElementById('player-title');
  var noteEl = document.getElementById('player-note');
  var bar = document.getElementById('player-bar');
  var timeEl = document.getElementById('player-time');
  var subEl = document.getElementById('player-sub');
  var audioEl = document.getElementById('player-audio');

  var hideTimer = null;
  var onClose = null;
  var hls = null;
  var urls = [];
  var urlIndex = 0;
  var startAt = 0;
  var currentType = '';
  var subs = [];        // subtitle track metadata
  var subIndex = 0;     // -1 = off
  var audioTracks = []; // audio track metadata (rarely more than one)

  function hlsAvailable(url) {
    return !!(window.Hls && Hls.isSupported() &&
      (currentType === 'hls' || /\.m3u8(\?|$)/i.test(url || '')));
  }

  function destroyHls() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
  }

  function fmt(sec) {
    if (!isFinite(sec)) return '--:--';
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var mm = (h && m < 10 ? '0' : '') + m;
    return (h ? h + ':' : '') + mm + ':' + (s < 10 ? '0' : '') + s;
  }

  function showOsd() {
    osd.classList.remove('faded');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (!video.paused) osd.classList.add('faded');
    }, 4000);
  }

  function updateSubLabel() {
    if (subEl) subEl.textContent = subs.length
      ? 'CC ' + (subIndex + 1) + '/' + subs.length + '  ' + (subIndex >= 0 ? (subs[subIndex].label || subs[subIndex].lang) : 'off')
      : '';
  }
  function updateAudioLabel() {
    if (audioEl) audioEl.textContent = audioTracks.length > 1
      ? 'Audio ' + (video.audioTracks ? video.audioTracks[0].language : '')
      : '';
  }

  function seek(delta) {
    if (!isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + delta));
    showOsd();
  }

  function toggle() {
    if (video.paused) video.play(); else video.pause();
    showOsd();
  }

  function applyStart() {
    if (!startAt) return;
    var t = function () {
      video.removeEventListener('loadedmetadata', t);
      if (isFinite(video.duration) && video.duration > 0) video.currentTime = startAt;
    };
    video.addEventListener('loadedmetadata', t);
  }

  function playNative(url) {
    video.src = url;
    video.load();
    applyStart();
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay blocked: user presses OK */ });
    showOsd();
  }

  function playHls(url) {
    destroyHls();
    hls = new Hls({ enableWorker: true, backBufferLength: 90 });
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      if (startAt) { hls.startPosition = startAt; }
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
      showOsd();
    });
    hls.on(Hls.Events.ERROR, function (ev, data) {
      if (data.fatal) fatal('frameXTV stream');
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    showOsd();
  }

  function playUrl(i) {
    urlIndex = i;
    var url = urls[i];
    if (hlsAvailable(url)) playHls(url);
    else playNative(url);
  }

  // Advance to the next mirror, or give up and show the failure.
  function fatal(why) {
    if (urlIndex < urls.length - 1) {
      noteEl.textContent = 'Retrying on next source…';
      playUrl(urlIndex + 1);
    } else {
      noteEl.textContent = 'Playback failed. ' + why + ' may not be supported on this TV.';
      osd.classList.remove('faded');
    }
  }

  // ---- Subtitles / audio ----
  function addTrack(sub) {
    var track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.label || sub.lang;
    track.srclang = sub.lang || sub.language || 'en';
    var src;
    if (sub.srcDoc) {
      src = URL.createObjectURL(new Blob([sub.srcDoc], { type: 'text/vtt' }));
    } else {
      src = sub.url;
    }
    track.src = src;
    track.dataset.idx = sub.idx;
    video.appendChild(track);
  }

  function loadSubtitles() {
    if (!subs.length) return;
    subs.forEach(function (sub) {
      if (sub.srcDoc) { addTrack(sub); return; }
      fetch(sub.url, { headers: { Accept: 'text/vtt, application/x-subrip' } })
        .then(function (r) { return r.text(); })
        .then(function (text) {
          // strem.io serves SRT-ish content labelled as subrip; normalise to WebVTT.
          if (text && text.indexOf('WEBVTT') === -1) text = 'WEBVTT\n\n' + text;
          sub.srcDoc = text;
          addTrack(sub);
        })
        .catch(function () { /* skip a track that fails to load */ });
    });
  }

  function cycleSubtitles(dir) {
    if (!subs.length) return;
    subIndex = (subIndex + dir + (subs.length + 1)) % (subs.length + 1);
    applySubtitles();
    showOsd();
  }

  function applySubtitles() {
    var trackEls = video.querySelectorAll('track');
    for (var i = 0; i < trackEls.length; i++) {
      var idx = Number(trackEls[i].dataset.idx);
      trackEls[i].mode = (idx === subIndex) ? 'showing' : 'hidden';
    }
    updateSubLabel();
  }

  function cycleAudio() {
    if (!audioTracks.length || !video.audioTracks || video.audioTracks.length < 2) return;
    var cur = 0;
    for (var i = 0; i < video.audioTracks.length; i++) {
      if (video.audioTracks[i].enabled) { cur = i; break; }
    }
    var next = (cur + 1) % video.audioTracks.length;
    video.audioTracks[cur].enabled = false;
    video.audioTracks[next].enabled = true;
    showOsd();
  }

  function close() {
    video.pause();
    destroyHls();
    video.removeAttribute('src');
    video.load();
    clearTracks();
    root.classList.add('hidden');
    Nav.setTrap(null);
    clearTimeout(hideTimer);
    if (onClose) onClose();
  }

  function clearTracks() {
    var trackEls = video.querySelectorAll('track');
    for (var i = 0; i < trackEls.length; i++) video.removeChild(trackEls[i]);
  }

  function handleKey(e) {
    switch (e.keyCode) {
      case Keys.ENTER:
      case Keys.PLAY_PAUSE: toggle(); return true;
      case Keys.PLAY: video.play(); showOsd(); return true;
      case Keys.PAUSE: video.pause(); showOsd(); return true;
      case Keys.LEFT: seek(-10); return true;
      case Keys.RIGHT: seek(10); return true;
      case Keys.RW: seek(-30); return true;
      case Keys.FF: seek(30); return true;
      case Keys.UP: cycleAudio(); return true;
      case Keys.DOWN: cycleSubtitles(1); return true;
      case Keys.BACK:
      case Keys.ESCAPE:
      case Keys.BACKSPACE:
      case Keys.STOP: close(); return true;
    }
    return false;
  }

  video.addEventListener('timeupdate', function () {
    var d = video.duration;
    bar.style.width = isFinite(d) && d > 0 ? (video.currentTime / d * 100) + '%' : '0';
    timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(d);
  });
  video.addEventListener('pause', showOsd);
  // Native-source errors (mp4, Safari HLS) also try the next mirror.
  video.addEventListener('error', function () {
    if (hls) return; // hls.js reports its own errors
    if (video.error && video.error.code !== MediaError.MEDIA_ERR_ABORTED) fatal('That file');
  });

  return {
    open: function (source, closeCallback) {
      onClose = closeCallback;
      currentType = source.type || '';
      startAt = source.startSeconds || 0;
      urls = [source.url].concat(source.fallback || []);
      subs = [];
      subIndex = 0;
      audioTracks = source.audioTracks || [];
      titleEl.textContent = source.title;
      noteEl.textContent = source.note || '';
      clearTracks();
      updateAudioLabel();
      bar.style.width = '0';
      timeEl.textContent = '';
      root.classList.remove('hidden');
      Nav.setTrap(handleKey);
      playUrl(0);

      // Pull subtitles for a frameXTV item and attach them.
      if (source.item && source.item.tmdbId && window.FrameXtvProvider && FrameXtvProvider.subtitles) {
        FrameXtvProvider.subtitles(source.item).then(function (list) {
          if (list && list.length) {
            list.forEach(function (s, i) { s.idx = i; });
            subs = list;
            subIndex = 0;
            loadSubtitles();
            updateSubLabel();
          }
        }).catch(function () {});
      }
    }
  };
})();
