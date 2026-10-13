// Fullscreen HTML5 video player driven by the remote.
var Player = (function () {
  var root = document.getElementById('player');
  var video = document.getElementById('video');
  var osd = document.getElementById('player-osd');
  var titleEl = document.getElementById('player-title');
  var noteEl = document.getElementById('player-note');
  var bar = document.getElementById('player-bar');
  var timeEl = document.getElementById('player-time');
  var hideTimer = null;
  var onClose = null;

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

  function seek(delta) {
    if (!isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + delta));
    showOsd();
  }

  function toggle() {
    if (video.paused) video.play(); else video.pause();
    showOsd();
  }

  function close() {
    video.pause();
    video.removeAttribute('src');
    video.load();
    root.classList.add('hidden');
    Nav.setTrap(null);
    clearTimeout(hideTimer);
    if (onClose) onClose();
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
      case Keys.UP:
      case Keys.DOWN: showOsd(); return true;
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
  video.addEventListener('error', function () {
    noteEl.textContent = 'Playback failed. The file format may not be supported by this TV.';
    osd.classList.remove('faded');
  });

  return {
    open: function (source, closeCallback) {
      onClose = closeCallback;
      titleEl.textContent = source.title;
      noteEl.textContent = source.note || '';
      bar.style.width = '0';
      timeEl.textContent = '';
      root.classList.remove('hidden');
      Nav.setTrap(handleKey);

      video.src = source.url;
      if (source.startSeconds) {
        video.addEventListener('loadedmetadata', function once() {
          video.removeEventListener('loadedmetadata', once);
          video.currentTime = source.startSeconds;
        });
      }
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* autoplay blocked: user presses OK */ });
      showOsd();
    }
  };
})();
