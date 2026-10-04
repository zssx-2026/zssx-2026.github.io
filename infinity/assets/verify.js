/*
 * Infinity.Inc - the gate in front of the suite's entry pages.
 *
 * What a visitor sees: a loading state, then the page. There is no checkbox,
 * no puzzle and no button - the proof-of-work runs silently in a worker and
 * the result is never shown, because a challenge a visitor can watch is a
 * challenge a visitor can be asked to solve.
 *
 * Why it takes seconds: the entry page is held for MIN_MS even when the work
 * finished at once, and it is released by MAX_MS at the latest. The work is a
 * hashcash search (verify-worker.js): SHA-256(prefix + nonce) must start with
 * a run of hex zeros. The target steps down while the page waits, so the
 * browser finishes well inside the window and nobody is turned away for
 * having a slow machine.
 *
 * Failure is deliberately quiet: if the worker cannot start or dies, or the
 * search is still unfinished at MAX_MS, the document is replaced by a page
 * that looks like the browser's own ERR_TIMED_OUT - a title and one sentence,
 * no code, no diagnostics - and nothing navigates anywhere.
 *
 * ?verify=reset          forgets a remembered pass and runs the gate again.
 * ?verify=difficulty=N   (N >= 5) raises the target. N=64 can never be met and
 *                        is how the timeout page is reproduced for testing.
 *                        It can only make the gate harder, never easier.
 */
(function () {
  'use strict';

  var KEY = 'infinity.verify';
  var VERSION = 1;

  var MIN_MS = 3000;   // content is never shown before this
  var MAX_MS = 5000;   // and the page always resolves by this
  var SHORT_MS = 700;  // returning visitors get the same look, briefly
  var STEP_MS = 800;   // lower the target while waiting, so the work finishes
  var ZEROS = 5;       // hex zeros the hash must start with
  var MIN_ZEROS = 3;

  var html = document.documentElement;
  var zh = String(html.getAttribute('lang') || '').toLowerCase().indexOf('zh') === 0;
  var T = zh
    ? { loading: '正在加载…', title: '响应时间过长', line: '该网页暂时无法访问，请稍后重试。' }
    : { loading: 'Loading…', title: 'This page took too long to respond', line: 'The page is temporarily unavailable. Please try again later.' };

  function now() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  var state = {
    mode: 'gate', startedAt: Date.now(), revealedAt: null, elapsedMs: null,
    result: 'pending', reason: '', solvedAt: null, zeros: ZEROS
  };
  window.__INFINITY_GATE = state;

  // ---------------------------------------------------------------- params
  var qs = null;
  try { qs = new URLSearchParams(location.search); } catch (e) { qs = null; }
  var param = qs ? qs.get('verify') : null;
  var wanted = qs ? qs.get('difficulty') : null;

  if (param === 'reset') {
    try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
  }

  var remembered = false;
  try {
    var stored = localStorage.getItem(KEY);
    if (stored) {
      var cred = JSON.parse(stored);
      if (cred && cred.v === VERSION) remembered = true;
    }
  } catch (e) { remembered = false; }
  state.mode = remembered ? 'remembered' : 'gate';

  // ---------------------------------------------------------------- overlay
  var started = now();

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  html.className = (html.className ? html.className + ' ' : '') + 'infinity-gate';

  var overlay = el('div');
  overlay.id = 'infinity-gate';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  var box = el('div', 'box');
  var brand = el('div', 'brand');
  brand.appendChild(el('span', 'dot'));
  brand.appendChild(document.createTextNode('Infinity.Inc'));
  var bar = el('div', 'bar');
  bar.appendChild(el('i'));
  box.appendChild(brand);
  box.appendChild(el('div', 'spinner'));
  box.appendChild(el('div', 'text', T.loading));
  box.appendChild(bar);
  overlay.appendChild(box);
  try { overlay.style.setProperty('--ig-ms', (remembered ? SHORT_MS : MIN_MS) + 'ms'); } catch (e) { /* older engines */ }
  html.appendChild(overlay);

  function clearGateClass() {
    html.className = html.className.split(/\s+/).filter(function (c) {
      return c && c !== 'infinity-gate';
    }).join(' ');
  }

  function reveal() {
    if (state.revealedAt) return;
    state.revealedAt = Date.now();
    state.elapsedMs = Math.round(now() - started);
    state.result = 'shown';
    clearGateClass();
    var node = document.getElementById('infinity-gate');
    if (node) {
      node.className = 'done';
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 240);
    }
    // A reset link left in the address would clear the pass again on the next
    // refresh; drop it now that it has been honoured.
    if (qs && qs.get('verify')) {
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ }
    }
  }

  var TIMEOUT_CSS = '<style>' +
    'html,body{margin:0;background:#0b0d12;color:#e6e9f0;}' +
    'body{font:15px/1.6 "Segoe UI",system-ui,-apple-system,"Noto Sans SC",sans-serif;}' +
    '.ig-timeout{min-height:100vh;display:flex;align-items:center;justify-content:center;}' +
    '.ig-timeout .box{max-width:520px;padding:0 24px;}' +
    '.ig-timeout h1{font-size:22px;font-weight:600;margin:0 0 10px;}' +
    '.ig-timeout p{margin:0;color:#98a0b3;}' +
    '</style>';

  function showTimeout(reason) {
    if (state.revealedAt) return;
    state.revealedAt = Date.now();
    state.elapsedMs = Math.round(now() - started);
    state.result = 'timeout';
    state.reason = reason || 'failed';
    html.className = 'ig-timed-out';
    html.innerHTML =
      '<head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + T.title + '</title>' + TIMEOUT_CSS + '</head>' +
      '<body><div class="ig-timeout"><div class="box"><h1>' + T.title + '</h1>' +
      '<p>' + T.line + '</p></div></div></body>';
  }

  if (remembered) {
    setTimeout(reveal, SHORT_MS);
    return;
  }

  // ------------------------------------------------------------- challenge
  var failed = false;
  var solved = false;
  var worker = null;
  var zeros = ZEROS;
  var explicit = false;

  // Read on its own: ?verify=reset&difficulty=64 has to mean both "forget the
  // pass" and "run the impossible target", which a single parameter could not.
  if (wanted !== null) {
    var n = parseInt(wanted, 10);
    if (isFinite(n) && n >= ZEROS && n <= 64) { zeros = n; explicit = true; }
  }
  state.zeros = zeros;

  function makePrefix() {
    var rnd = '';
    try {
      var buf = new Uint8Array(8);
      var c = window.crypto || window.msCrypto;
      c.getRandomValues(buf);
      for (var i = 0; i < buf.length; i++) rnd += ('0' + buf[i].toString(16)).slice(-2);
    } catch (e) {
      rnd = Math.random().toString(16).slice(2, 18) + Date.now().toString(16);
    }
    return 'infinity-gate|' + VERSION + '|' + rnd + '|';
  }

  function startWorker() {
    if (typeof Worker !== 'function') { failed = true; state.reason = 'worker-unavailable'; return; }
    var url = 'assets/verify-worker.js';
    try {
      var src = document.currentScript ? document.currentScript.src : '';
      if (src && /verify\.js$/.test(src)) url = src.replace(/verify\.js$/, 'verify-worker.js');
    } catch (e) { /* keep the relative fallback */ }
    try {
      worker = new Worker(url);
    } catch (e) { failed = true; state.reason = 'worker-create'; return; }
    worker.onerror = function () { failed = true; state.reason = 'worker-error'; };
    worker.onmessage = function (ev) {
      var d = ev.data || {};
      if (d.type === 'solved') {
        solved = true;
        state.solvedAt = Date.now();
        state.zeros = d.zeros;
        finish();
      }
    };
    worker.postMessage({ cmd: 'start', prefix: makePrefix(), zeros: zeros });
  }

  function finish() {
    if (state.revealedAt) return;
    var waited = now() - started;
    if (failed) {
      if (waited >= MIN_MS) showTimeout(state.reason);
      return;
    }
    if (solved && waited >= MIN_MS) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ts: Date.now(), zeros: state.zeros }));
      } catch (e) { /* private mode: the gate simply runs again next time */ }
      reveal();
    }
  }

  startWorker();
  setInterval(finish, 60);
  setInterval(function () {
    if (explicit || failed || solved || !worker) return;
    if (zeros > MIN_ZEROS) {
      zeros--;
      state.zeros = zeros;
      worker.postMessage({ cmd: 'zeros', zeros: zeros });
    }
  }, STEP_MS);
  setTimeout(function () {
    if (state.revealedAt) return;
    finish();
    if (!state.revealedAt) showTimeout(failed ? (state.reason || 'failed') : 'max-time');
  }, MAX_MS);
})();
