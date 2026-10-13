// App shell: routing, history (Back key), toasts, and the play flow.
var App = (function () {
  var view = document.getElementById('view');
  var toastEl = document.getElementById('toast');
  var stack = []; // [{ name, params, focusIndex }]
  var toastTimer = null;
  var lastBackAt = 0;

  function render(entry, restoreIndex) {
    view.innerHTML = '';
    view.scrollTop = 0;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-route') === entry.name);
    }
    Views[entry.name](view, entry.params || {});
    if (restoreIndex !== undefined) {
      var el = view.querySelectorAll('.focusable')[restoreIndex];
      if (el) Nav.focus(el);
    }
    if (!view.contains(Nav.current())) Nav.focusFirst(view);
  }

  function focusIndex() {
    var all = Array.prototype.slice.call(view.querySelectorAll('.focusable'));
    return all.indexOf(Nav.current());
  }

  function go(name, params, replace) {
    var top = stack[stack.length - 1];
    if (replace && top) stack.pop();
    else if (top) top.focusIndex = focusIndex();
    // Tabs are top-level: switching tabs resets history to that tab.
    if (name === 'home' || name === 'search' || name === 'settings') {
      if (!replace) stack = [];
    }
    var entry = { name: name, params: params || {} };
    stack.push(entry);
    render(entry);
  }

  function back() {
    if (stack.length > 1) {
      stack.pop();
      var prev = stack[stack.length - 1];
      render(prev, prev.focusIndex >= 0 ? prev.focusIndex : undefined);
      return;
    }
    if (stack[0] && stack[0].name !== 'home') { go('home'); return; }
    // On home: press Back twice to exit.
    var now = Date.now();
    if (now - lastBackAt < 2000) exit();
    else { lastBackAt = now; toast('Press Back again to exit'); }
  }

  function exit() {
    try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* not on a TV */ }
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.add('hidden'); }, 3000);
  }

  function play(item) {
    var returnFocus = Nav.current();
    toast('Finding a source…');
    Providers.resolve(item).then(function (source) {
      if (!source) { toast('Not found on your server'); return; }
      toastEl.classList.add('hidden');
      Player.open(source, function () { if (returnFocus) Nav.focus(returnFocus); });
    }).catch(function (err) {
      toast('Playback error: ' + err.message);
    });
  }

  function registerRemoteKeys() {
    try {
      var keys = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
        'MediaFastForward', 'MediaRewind', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'];
      keys.forEach(function (k) { tizen.tvinputdevice.registerKey(k); });
    } catch (e) { /* desktop browser */ }
  }

  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function () { go(this.getAttribute('data-route')); });
  }

  Nav.onBack(back);
  registerRemoteKeys();

  return { go: go, back: back, toast: toast, play: play };
})();

App.go('home');
