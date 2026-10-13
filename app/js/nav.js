// Spatial navigation for the TV remote: arrow keys move focus to the nearest
// `.focusable` element in that direction; horizontal rows and the main view
// are scrolled so the focused element stays on screen.
var Keys = {
  LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
  BACK: 10009, ESCAPE: 27, BACKSPACE: 8,
  PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413, FF: 417, RW: 412
};

var Nav = (function () {
  var current = null;
  var trap = null; // when set, receives every key first (used by the player)
  var backHandler = null;

  function visible(el) {
    if (!el.offsetParent && el !== document.body) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function candidates() {
    var all = document.querySelectorAll('.focusable');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].disabled && visible(all[i])) out.push(all[i]);
    }
    return out;
  }

  function center(r) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Pick the closest candidate in `dir`, penalising off-axis distance heavily so
  // that LEFT/RIGHT stay in the same row and UP/DOWN keep horizontal alignment.
  function findNext(dir) {
    if (!current || !document.body.contains(current)) return candidates()[0];
    var from = current.getBoundingClientRect();
    var c = center(from);
    var best = null;
    var bestScore = Infinity;

    candidates().forEach(function (el) {
      if (el === current) return;
      var r = el.getBoundingClientRect();
      var e = center(r);
      var main, cross;
      if (dir === 'left') { if (r.right > from.left + 1) return; main = from.left - r.right; cross = Math.abs(e.y - c.y); }
      if (dir === 'right') { if (r.left < from.right - 1) return; main = r.left - from.right; cross = Math.abs(e.y - c.y); }
      if (dir === 'up') { if (r.bottom > from.top + 1) return; main = from.top - r.bottom; cross = Math.abs(e.x - c.x); }
      if (dir === 'down') { if (r.top < from.bottom - 1) return; main = r.top - from.bottom; cross = Math.abs(e.x - c.x); }
      var score = main + cross * (dir === 'left' || dir === 'right' ? 4 : 1.5);
      if (score < bestScore) { bestScore = score; best = el; }
    });
    return best;
  }

  function scrollIntoView(el) {
    var track = el.closest('.row-track');
    if (track) {
      var pad = 60;
      var left = el.offsetLeft - track.offsetLeft;
      if (left - pad < track.scrollLeft) track.scrollLeft = Math.max(0, left - pad);
      else if (left + el.offsetWidth + pad > track.scrollLeft + track.clientWidth) {
        track.scrollLeft = left + el.offsetWidth + pad - track.clientWidth;
      }
    }
    // Vertical scrolling: nearest `.scroll-y` ancestor. `data-pad-top` keeps content clear of overlays.
    var box = el.closest('.scroll-y');
    if (box) {
      var block = el.closest('.row') || el;
      var padTop = Number(box.getAttribute('data-pad-top') || 40);
      var vr = box.getBoundingClientRect();
      var br = block.getBoundingClientRect();
      if (box.getAttribute('data-snap') === 'row' && block !== el) box.scrollTop += br.top - vr.top;
      else if (br.top < vr.top + padTop) box.scrollTop -= (vr.top + padTop - br.top);
      else if (br.bottom > vr.bottom - 40) box.scrollTop += (br.bottom - vr.bottom + 40);
      if (el === box.querySelector('.focusable')) box.scrollTop = 0;
    }
  }

  var listeners = [];

  function focus(el) {
    if (!el) return;
    if (current) current.classList.remove('focused');
    current = el;
    el.classList.add('focused');
    el.focus({ preventScroll: true });
    scrollIntoView(el);
    listeners.forEach(function (fn) { fn(el); });
  }

  function move(dir) {
    var next = findNext(dir);
    if (next) focus(next);
  }

  // Inside text inputs, LEFT/RIGHT move the caret until it reaches an edge.
  function inputKeepsKey(e) {
    var el = document.activeElement;
    if (!el || el.tagName !== 'INPUT') return false;
    if (e.keyCode === Keys.LEFT) return el.selectionStart > 0;
    if (e.keyCode === Keys.RIGHT) return el.selectionEnd < el.value.length;
    if (e.keyCode === Keys.BACKSPACE) return true;
    return false;
  }

  function onKeyDown(e) {
    if (trap && trap(e)) { e.preventDefault(); return; }
    if (inputKeepsKey(e)) return;

    switch (e.keyCode) {
      case Keys.LEFT: move('left'); break;
      case Keys.RIGHT: move('right'); break;
      case Keys.UP: move('up'); break;
      case Keys.DOWN: move('down'); break;
      case Keys.ENTER:
        if (current && current.tagName === 'INPUT') return; // let the TV keyboard open
        if (current) current.click();
        break;
      case Keys.BACK:
      case Keys.ESCAPE:
      case Keys.BACKSPACE:
        if (backHandler) backHandler();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  document.addEventListener('keydown', onKeyDown);

  // Keep the highlight in sync when focus changes via mouse/pointer (desktop testing).
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('.focusable');
    if (el && el !== current) focus(el);
  }, true);

  return {
    focus: focus,
    focusFirst: function (root) {
      var el = (root || document).querySelector('.focusable:not([disabled])');
      if (el) focus(el);
    },
    current: function () { return current; },
    setTrap: function (fn) { trap = fn; },
    onFocus: function (fn) { listeners.push(fn); },
    onBack: function (fn) { backHandler = fn; }
  };
})();
