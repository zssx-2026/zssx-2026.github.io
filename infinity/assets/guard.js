/*
 * Infinity.Inc - the environment check that runs before a page settles.
 *
 * It is silent, and that is a requirement rather than an oversight. The check
 * used to draw a full-screen overlay on every page and send a machine it
 * suspected to an error page; a visitor saw a spinner on all thirty-two pages
 * of the suite and, when it miscalled a slow reader, an error page. Both were
 * worse than the traffic they guarded against.
 *
 * What is left is the analysis without the interruption:
 *
 *   - nothing is drawn, on any page, at any point;
 *   - no page is ever redirected away from where the reader asked to go;
 *   - the callback a page hands in runs at once, so content is never held;
 *   - the verdict is still computed and left on window.INFINITY_GUARD for the
 *     pages that want to look at it.
 *
 * A check that does not delay the reader is also a check that cannot fail the
 * reader, which is the right trade for a documentation and download site.
 */
(function () {
  'use strict';

  var KEY = 'infinity.guard.v1';
  var STILL = 0;
  var PASS = 1;
  var FAIL = 2;

  function Attempt() {
    this.moves = 0;
    this.samples = [];
  }

  Attempt.prototype.add = function (x, y) {
    this.moves++;
    var last = this.samples[this.samples.length - 1];
    var t = Date.now();
    if (last) {
      var dx = x - last.x;
      var dy = y - last.y;
      var dt = t - last.t || 1;
      last.speed = Math.sqrt(dx * dx + dy * dy) / dt * 1000;
      last.dx = dx;
      last.dy = dy;
      last.dt = dt;
    }
    this.samples.push({ x: x, y: y, t: t, speed: 0 });
    if (this.samples.length > 64) this.samples.shift();
  };

  Attempt.prototype.judge = function () {
    if (this.moves < 12) return STILL;
    var speeds = this.samples.filter(function (s) { return s.speed > 0; }).map(function (s) { return s.speed; });
    if (speeds.length >= 6) {
      var fast = speeds.filter(function (s) { return s > 3200; }).length;
      if (fast / speeds.length > 0.7) return FAIL;
    }
    var deltas = this.samples.slice(1).filter(function (s) { return s.dt; }).map(function (s) { return s.dt; });
    if (deltas.length >= 12) {
      var same = deltas.filter(function (d) { return d === deltas[0]; }).length;
      if (same === deltas.length) return FAIL;
    }
    return PASS;
  };

  function passed() {
    try { return sessionStorage.getItem(KEY) === 'ok'; } catch (e) { return false; }
  }

  function remember() {
    try { sessionStorage.setItem(KEY, 'ok'); } catch (e) { /* private mode */ }
  }

  var state = { verdict: 'unknown', moves: 0, at: null };

  function run(onPass) {
    var attempt = new Attempt();
    function onMove(ev) {
      attempt.add(ev.clientX, ev.clientY);
      state.moves = attempt.moves;
    }
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('touchmove', function (ev) {
      if (!ev.touches || !ev.touches.length) return;
      attempt.add(ev.touches[0].clientX, ev.touches[0].clientY);
      state.moves = attempt.moves;
    }, true);
    setTimeout(function () {
      window.removeEventListener('mousemove', onMove, true);
      var verdict = attempt.judge();
      state.verdict = verdict === FAIL ? 'machine' : verdict === PASS ? 'human' : 'quiet';
      state.at = Date.now();
      if (verdict !== FAIL) remember();
    }, 4000);
    if (onPass) onPass();   /* the reader is never made to wait for it */
  }

  window.INFINITY_GUARD = {
    run: run,
    passed: passed,
    get state() { return state; },
    reset: function () { try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  };

  if (!window.INFINITY_GUARD_NOAUTO) run(function () { });
})();
