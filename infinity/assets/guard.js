/*
 * guard.js - the check a page runs before it will show anything.
 *
 * The threat is a script, not a person: something that opens every download
 * page and harvests the links, or drives a headless browser at the API. A
 * script moves a pointer the way arithmetic moves it - in a straight line,
 * at a constant speed, with the same gap between every sample - and that is
 * exactly what this looks for.
 *
 * What it deliberately does NOT do is require movement.
 *
 * A page that takes a moment to load is a page the reader leaves. Most of
 * them open another tab while they wait; they come back, the check resumes,
 * and the pointer may not have entered the window at all in the meantime.
 * Failing somebody for not moving the mouse would fail almost everybody. So
 * the rules are one-sided: silence passes, and only evidence of a machine
 * fails.
 *
 * The thresholds come from what a hand actually does:
 *
 *   speed      a fast flick reaches about 1000 px/s and no further; anything
 *              past that is a teleport or a synthetic event.
 *   mean       a hand averages around 126 px/s, but a sample of a few
 *              hundred milliseconds proves nothing on its own, so the mean
 *              is used as a tie-breaker, never as a verdict.
 *   straight   a hand crossing the window curves; a path whose bearing never
 *              changes over a long run was drawn, not moved.
 *   gap        real events arrive at irregular intervals. Identical deltas
 *              across a whole sample are a timer, not a hand.
 */
(function () {
  'use strict';

  var KEY = "infinity.guard.v1";
  var STILL = 0;      /* no verdict yet - keep waiting */
  var PASS = 1;
  var FAIL = 2;

  /*
   * One attempt, accumulating. Reset on a page load rather than shared,
   * because a verdict reached on one page should not silently clear the
   * next one if the reader has since opened a different site.
   */
  function Attempt() {
    this.samples = [];     /* {t, x, y} */
    this.first = 0;
    this.last = 0;
    this.stillSince = 0;
    this.moves = 0;
  }

  Attempt.prototype.add = function (x, y) {
    var now = (window.performance && performance.now ? performance.now() : Date.now());
    if (!this.first) this.first = now;
    this.last = now;
    this.moves++;
    /* A point per frame is enough; the shape of the path is what matters,
     * not the sample rate. */
    if (this.samples.length) {
      var p = this.samples[this.samples.length - 1];
      if (now - p.t < 16) { p.x = x; p.y = y; return; }
    }
    this.samples.push({ t: now, x: x, y: y });
    if (this.samples.length > 400) this.samples.shift();
  };

  /*
   * The verdict. Returns STILL while the evidence is inconclusive - which
   * is the normal answer for somebody who is reading another tab.
   */
  Attempt.prototype.judge = function () {
    var s = this.samples;
    if (s.length < 6) return STILL;

    var speeds = [];
    var deltas = [];
    var bearings = [];
    var maxSpeed = 0;

    for (var i = 1; i < s.length; i++) {
      var dt = (s[i].t - s[i - 1].t) / 1000;
      if (dt <= 0) continue;
      var dx = s[i].x - s[i - 1].x;
      var dy = s[i].y - s[i - 1].y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var v = dist / dt;
      speeds.push(v);
      deltas.push(dt);
      if (dist > 4) bearings.push(Math.atan2(dy, dx));
      if (v > maxSpeed) maxSpeed = v;
    }
    if (speeds.length < 5) return STILL;

    /* A hand cannot cross a screen at over 1000 px/s. Allow a quarter more
     * for a coalesced burst - browsers batch events under load - and treat
     * anything past that as not a hand. */
    if (maxSpeed > 1250) return FAIL;

    var sum = 0;
    for (var k = 0; k < speeds.length; k++) sum += speeds[k];
    var mean = sum / speeds.length;

    /* Every gap the same to within a tenth of a millisecond: a timer. */
    if (deltas.length >= 12) {
      var dmin = deltas[0], dmax = deltas[0];
      for (var d = 1; d < deltas.length; d++) {
        if (deltas[d] < dmin) dmin = deltas[d];
        if (deltas[d] > dmax) dmax = deltas[d];
      }
      if (dmax - dmin < 0.0001) return FAIL;
    }

    /*
     * Straightness. A long run of movement whose bearing never wanders is a
     * line, and a line is what a script draws. The test is on the spread of
     * the bearing, not on whether it is exactly constant, because a hand can
     * hold a course for a short distance and cannot for a long one.
     */
    if (bearings.length >= 20) {
      var straight = 0;
      var best = 0;
      for (var b = 1; b < bearings.length; b++) {
        var diff = Math.abs(bearings[b] - bearings[b - 1]);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff < 0.02) { straight++; if (straight > best) best = straight; }
        else straight = 0;
      }
      if (best >= 18) return FAIL;
    }

    /*
     * A constant speed across a long sample. A hand accelerates and slows;
     * a machine holds a number. Only fails when the sample is long enough
     * and the speeds are flat enough that no hand could have done it.
     */
    if (speeds.length >= 24 && mean > 40) {
      var dev = 0;
      for (var q = 0; q < speeds.length; q++) dev += Math.abs(speeds[q] - mean);
      dev = dev / speeds.length;
      if (dev / mean < 0.02) return FAIL;
    }

    /*
     * Enough quiet movement at a plausible pace. Reaching here means
     * nothing ruled the reader out, and the longer they have been moving
     * the more confident that is - so this is the passing condition.
     */
    if (this.moves >= 40 && (this.last - this.first) > 350) return PASS;
    return STILL;
  };

  /* Automation leaves marks that no amount of mouse movement erases. */
  function automated() {
    if (navigator.webdriver) return true;
    /* A headless browser reports a plugin list of zero and no languages. */
    if (navigator.plugins && navigator.plugins.length === 0 &&
        navigator.languages && navigator.languages.length === 0) return true;
    return false;
  }

  function passed() {
    try { return sessionStorage.getItem(KEY) === "ok"; } catch (e) { return false; }
  }

  function remember() {
    try { sessionStorage.setItem(KEY, "ok"); } catch (e) { }
  }

  /*
   * Sent to the error page rather than shown as a message on this one.
   * A check that explains itself is a check that can be studied; the
   * requirement is a redirect, so this redirects.
   */
  function bail() {
    var cn = location.pathname.indexOf("/cn/") === 0 || location.pathname.indexOf("/cn/") >= 0;
    var base = location.pathname.slice(0, location.pathname.indexOf("/infinity/") + "/infinity/".length);
    if (!base) base = "/infinity/";
    location.replace(base + (cn ? "cn/" : "") + "error/");
  }

  /*
   * The overlay. A spinner and a sentence, drawn over the page while the
   * evidence accumulates. It is built with plain DOM calls because this file
   * loads before site.js does.
   */
  function overlay() {
    var box = document.createElement("div");
    box.id = "guard";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    var style = document.createElement("style");
    style.textContent = [
      "#guard{position:fixed;inset:0;z-index:9999;background:var(--bg,#0b0d12);",
      "display:flex;align-items:center;justify-content:center;flex-direction:column;",
      "gap:18px;transition:opacity .3s ease;font:14px/1.6 system-ui,sans-serif;color:var(--ink,#e6e9f0)}",
      "#guard .ring{width:44px;height:44px;border-radius:50%;",
      "border:3px solid var(--line,#232838);border-top-color:var(--accent,#4c8dff);",
      "animation:gspin 1s linear infinite}",
      "@keyframes gspin{to{transform:rotate(360deg)}}",
      "#guard .msg{color:var(--ink-dim,#98a0b3)}",
      "#guard .sub{color:var(--ink-faint,#5d6577);font-size:13px}",
      "#guard.gone{opacity:0;pointer-events:none}",
      "@media (prefers-reduced-motion:reduce){#guard .ring{animation-duration:2.4s}}",
      "]".replace(/^\s*/, "")
    ].join("");
    document.head.appendChild(style);
    var ring = document.createElement("div");
    ring.className = "ring";
    var msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = "正在加载中…";
    var sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = "正在检查浏览器环境，请稍候。";
    box.appendChild(ring);
    box.appendChild(msg);
    box.appendChild(sub);
    document.body.appendChild(box);
    return box;
  }

  /*
   * The veil is lifted gradually rather than removed: the UI fades in over
   * the check as it completes, which is what "逐渐加载UI" asks for and also
   * gives the page a moment to lay itself out before it is seen.
   */
  function lift(box, done) {
    box.classList.add("gone");
    setTimeout(function () {
      if (box.parentNode) box.parentNode.removeChild(box);
      if (done) done();
    }, 320);
  }

  /*
   * Run the check. `onPass` is called once, after the overlay is gone.
   *
   * A reader who has already passed this session is let through with no
   * overlay at all - re-checking every internal navigation would make the
   * site feel broken, and the requirement scopes the check to requests that
   * did not come from the site itself.
   */
  function run(onPass) {
    var internal = false;
    try {
      var ref = document.referrer || "";
      internal = ref.indexOf(location.host) >= 0;
    } catch (e) { }

    if (passed() || internal) { if (onPass) onPass(); return; }

    /*
     * Wait for the body before drawing. This script is loaded from <head>,
     * so at parse time there is nowhere to put an overlay yet.
     */
    function begin() {
      if (automated()) { bail(); return; }

      var box = overlay();
      var a = new Attempt();
      var finished = false;
      var grace = 12000;   /* how long a reader is given to move at all */
      var hard = 30000;    /* the outer limit before the page opens anyway */

      function settle(verdict) {
        if (finished) return;
        if (verdict === FAIL) { finished = true; bail(); return; }
        if (verdict === PASS) {
          finished = true;
          remember();
          window.removeEventListener("mousemove", onMove, true);
          window.removeEventListener("touchmove", onTouch, true);
          lift(box, onPass);
        }
      }

      function onMove(ev) {
        if (finished) return;
        a.add(ev.clientX, ev.clientY);
        settle(a.judge());
      }
      function onTouch(ev) {
        if (finished || !ev.touches || !ev.touches.length) return;
        a.add(ev.touches[0].clientX, ev.touches[0].clientY);
        settle(a.judge());
      }

      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("touchmove", onTouch, true);

      /*
       * The clock is the other way out. Most readers look away while a page
       * loads, and a check that waited for movement would hold them there
       * when they came back. After the grace period the page opens on the
       * evidence gathered so far - which has already been judged, so a
       * machine never reaches this line - and after the hard limit it opens
       * regardless, because a stuck overlay is worse than a missed bot.
       */
      setTimeout(function () {
        if (finished) return;
        if (a.judge() === PASS) { settle(PASS); return; }
        /* Nothing ruled them out and they may simply be elsewhere. */
        finished = true;
        remember();
        lift(box, onPass);
      }, a.moves === 0 ? grace : 6000);

      setTimeout(function () {
        if (finished) return;
        finished = true;
        remember();
        lift(box, onPass);
      }, hard);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", begin);
    } else begin();
  }

  /*
   * Auto-run. Every page loads this from <head>, so the overlay is drawn
   * as soon as the body exists and lifted when the check settles. A page
   * that must not be checked - the error page, which is where a failed
   * check lands - sets window.INFINITY_GUARD_NOAUTO before this script
   * runs, and nothing happens.
   */
  if (!window.INFINITY_GUARD_NOAUTO) {
    run(function () { });
  }

  window.INFINITY_GUARD = { run: run, passed: passed, reset: function () {
    try { sessionStorage.removeItem(KEY); } catch (e) { }
  } };
})();
