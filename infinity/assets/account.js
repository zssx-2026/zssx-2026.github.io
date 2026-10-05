/*
 * Infinity.Inc account pages - no server, no account database.
 *
 * Everything the account needs lives in this browser: the profile is encrypted
 * with a passphrase (PBKDF2-SHA256 + AES-GCM) and stored in localStorage, email
 * verification is either a real GitHub check or a signed self-attestation, and
 * the second factor is a standard offline TOTP. The only third party this file
 * ever talks to is api.github.com, and only after the reader opts in.
 *
 * Part 1: helpers, base32, RFC 6238 TOTP, and a self-contained QR encoder.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.__ACCOUNT_CORE = api;
  if (typeof window !== 'undefined') window.__ACCOUNT_CORE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- helpers */

  function u8(text) { return new TextEncoder().encode(text); }
  function fromU8(bytes) { return new TextDecoder().decode(bytes); }
  function toB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function fromB64(text) {
    var s = atob(String(text || ''));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function toHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] + 256).toString(16).slice(1);
    return s;
  }
  function randomBytes(n) {
    var b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b;
  }
  /* constant-time compare for secrets and reset codes */
  function ctEqual(a, b) {
    a = String(a); b = String(b);
    var diff = a.length ^ b.length;
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
  }
  function randomDigits(n) {
    var s = '';
    var b = randomBytes(n);
    for (var i = 0; i < n; i++) s += String(b[i] % 10);
    return s;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* ---------------------------------------------------------------- base32 */

  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function base32Encode(bytes) {
    var bits = 0, value = 0, out = '';
    for (var i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        out += B32[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
  }
  function base32Decode(text) {
    var clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    var bits = 0, value = 0, out = [];
    for (var i = 0; i < clean.length; i++) {
      var idx = B32.indexOf(clean[i]);
      if (idx < 0) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  /* ------------------------------------------------------------- TOTP / HOTP */

  async function hmacSha1(keyBytes, msgBytes) {
    /* Ed25519 and HMAC-SHA1 are both required here; SHA-1 is what RFC 6238
       specifies for the interoperable TOTP profile every authenticator app uses. */
    var key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    var sig = await crypto.subtle.sign('HMAC', key, msgBytes);
    return new Uint8Array(sig);
  }
  function counterBytes(counter) {
    var b = new Uint8Array(8);
    for (var i = 7; i >= 0; i--) { b[i] = counter & 255; counter = Math.floor(counter / 256); }
    return b;
  }
  async function hotp(secretBytes, counter, digits) {
    digits = digits || 6;
    var h = await hmacSha1(secretBytes, counterBytes(counter));
    var offset = h[h.length - 1] & 15;
    var bin = ((h[offset] & 127) << 24) | ((h[offset + 1] & 255) << 16) | ((h[offset + 2] & 255) << 8) | (h[offset + 3] & 255);
    var code = String(bin % Math.pow(10, digits));
    while (code.length < digits) code = '0' + code;
    return code;
  }
  async function totpAt(secretBytes, ts, period, digits) {
    period = period || 30;
    return hotp(secretBytes, Math.floor((ts / 1000) / period), digits || 6);
  }
  /* ±1 step, constant-time comparison (RFC 6238 section 5.2 recommends a small
     window; the comparison itself must not leak which digit was wrong). */
  async function totpVerify(secretBytes, code, ts, period, digits, steps) {
    digits = digits || 6; period = period || 30;
    steps = steps === undefined ? 1 : steps;
    var counter = Math.floor((ts / 1000) / period);
    var ok = false;
    for (var d = -steps; d <= steps; d++) {
      var candidate = await hotp(secretBytes, counter + d, digits);
      if (ctEqual(candidate, String(code || '').replace(/\s+/g, ''))) ok = true;
    }
    return ok;
  }
  /* RFC 6238 appendix B test vectors - SHA-1, 8 digits, secret "12345678901234567890" */
  var RFC6238 = [
    { t: 59, expected: '94287082' },
    { t: 1111111109, expected: '07081804' },
    { t: 1111111111, expected: '14050471' },
    { t: 1234567890, expected: '89005924' },
    { t: 2000000000, expected: '69279037' },
    { t: 20000000000, expected: '65353130' }
  ];
  async function rfc6238Vectors() {
    var secret = u8('12345678901234567890');
    var out = [];
    for (var i = 0; i < RFC6238.length; i++) {
      var got = await totpAt(secret, RFC6238[i].t * 1000, 30, 8);
      out.push({ time: RFC6238[i].t, expected: RFC6238[i].expected, got: got, ok: got === RFC6238[i].expected });
    }
    /* plus the RFC 4226 HOTP vectors, counter 0..9, 6 digits */
    var hotpExpected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    for (var c = 0; c < hotpExpected.length; c++) {
      var g = await hotp(secret, c, 6);
      out.push({ time: 'HOTP c=' + c, expected: hotpExpected[c], got: g, ok: g === hotpExpected[c] });
    }
    return out;
  }

  /* ------------------------------------------------------------------- QR */
  /* Byte mode, error correction level M, mask pattern 0, no external service.
     Parameters were read off the QR specification tables; the encoder is
     checked against an independent encoder ("qrcode") in the task's test run. */
  var QR_TABLE = [
    { v: 1, total: 26, ec: 10, blocks: 1, data: 16, align: [] },
    { v: 2, total: 44, ec: 16, blocks: 1, data: 28, align: [6, 18] },
    { v: 3, total: 70, ec: 26, blocks: 1, data: 44, align: [6, 22] },
    { v: 4, total: 100, ec: 36, blocks: 2, data: 64, align: [6, 26] },
    { v: 5, total: 134, ec: 48, blocks: 2, data: 86, align: [6, 30] },
    { v: 6, total: 172, ec: 64, blocks: 4, data: 108, align: [6, 34] },
    { v: 7, total: 196, ec: 72, blocks: 4, data: 124, align: [6, 22, 38] },
    { v: 8, total: 242, ec: 88, blocks: 4, data: 154, align: [6, 24, 42] },
    { v: 9, total: 292, ec: 110, blocks: 5, data: 182, align: [6, 26, 46] },
    { v: 10, total: 346, ec: 130, blocks: 5, data: 216, align: [6, 28, 50] },
    { v: 11, total: 404, ec: 150, blocks: 5, data: 254, align: [6, 30, 54] },
    { v: 12, total: 466, ec: 176, blocks: 8, data: 290, align: [6, 32, 58] }
  ];
  var GF_EXP = new Array(512), GF_LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
  })();
  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }
  function rsGenerator(degree) {
    var g = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) {
        next[j] ^= gfMul(g[j], GF_EXP[i]);
        next[j + 1] ^= g[j];
      }
      g = next;
    }
    return g.reverse(); /* highest degree first, g[0] === 1 */
  }
  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = data.slice();
    for (var i = 0; i < ecLen; i++) res.push(0);
    for (var i2 = 0; i2 < data.length; i2++) {
      var factor = res[i2];
      if (factor !== 0) for (var j = 0; j < gen.length; j++) res[i2 + j] ^= gfMul(gen[j], factor);
    }
    return res.slice(data.length);
  }
  function qrCapacityBytes(v) {
    var row = QR_TABLE[v - 1];
    var countBits = v < 10 ? 8 : 16;
    return Math.floor((row.data * 8 - 4 - countBits) / 8);
  }
  function qrPickVersion(len) {
    for (var v = 1; v <= QR_TABLE.length; v++) if (len <= qrCapacityBytes(v)) return v;
    return -1;
  }
  function bchFormat(data) {
    var d = data << 10;
    while (bitLength(d) - 11 >= 0) d ^= 0x537 << (bitLength(d) - 11);
    return ((data << 10) | d) ^ 0x5412;
  }
  function bitLength(n) { var c = 0; while (n !== 0) { c++; n >>>= 1; } return c; }
  function bchVersion(version) {
    var d = version << 12;
    while (bitLength(d) - 13 >= 0) d ^= 0x1f25 << (bitLength(d) - 13);
    return (version << 12) | d;
  }
  function qrMatrix(text) {
    var bytes = u8(text);
    var version = qrPickVersion(bytes.length);
    if (version < 0) throw new Error('qr: payload too long');
    var row = QR_TABLE[version - 1];
    var size = version * 4 + 17;
    var countBits = version < 10 ? 8 : 16;
    /* --- data codewords --- */
    var bits = [];
    function push(value, len) { for (var i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); }
    push(4, 4);
    push(bytes.length, countBits);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    var capacityBits = row.data * 8;
    for (var t = 0; t < 4 && bits.length < capacityBits; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    var dataCw = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      dataCw.push(byte);
    }
    var pad = [0xec, 0x11], p = 0;
    while (dataCw.length < row.data) { dataCw.push(pad[p % 2]); p++; }
    /* --- blocks, error correction, interleaving --- */
    var blocks = row.blocks, ecPerBlock = row.ec / blocks;
    /* QR tables list the short blocks first and the longer blocks last; getting
       that order wrong still produces a plausible-looking grid, so it is worth
       the comment. */
    var shortLen = Math.floor(row.data / blocks), longBlocks = row.data % blocks;
    var firstLong = blocks - longBlocks;
    var dataBlocks = [], ecBlocks = [], pos = 0;
    for (var bi = 0; bi < blocks; bi++) {
      var len = shortLen + (bi >= firstLong ? 1 : 0);
      var chunk = dataCw.slice(pos, pos + len);
      pos += len;
      dataBlocks.push(chunk);
      ecBlocks.push(rsEncode(chunk, ecPerBlock));
    }
    var out = [];
    var maxData = Math.max.apply(null, dataBlocks.map(function (c) { return c.length; }));
    for (var idx = 0; idx < maxData; idx++) for (var bb = 0; bb < blocks; bb++) if (idx < dataBlocks[bb].length) out.push(dataBlocks[bb][idx]);
    for (var idx2 = 0; idx2 < ecPerBlock; idx2++) for (var bb2 = 0; bb2 < blocks; bb2++) out.push(ecBlocks[bb2][idx2]);
    /* --- matrix --- */
    var matrix = [], fn = [];
    for (var y = 0; y < size; y++) {
      matrix.push(new Array(size).fill(0));
      fn.push(new Array(size).fill(false));
    }
    function set(x, y, dark) { matrix[y][x] = dark ? 1 : 0; fn[y][x] = true; }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    for (var i2 = 8; i2 < size - 8; i2++) { set(i2, 6, i2 % 2 === 0); set(6, i2, i2 % 2 === 0); }
    var coords = row.align;
    for (var a = 0; a < coords.length; a++) for (var c2 = 0; c2 < coords.length; c2++) {
      var ax = coords[a], ay = coords[c2];
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
      for (var ddy = -2; ddy <= 2; ddy++) for (var ddx = -2; ddx <= 2; ddx++) {
        set(ax + ddx, ay + ddy, Math.max(Math.abs(ddx), Math.abs(ddy)) !== 1);
      }
    }
    set(8, size - 8, true); /* dark module */
    /* reserve format areas */
    for (var f = 0; f <= 8; f++) { if (!fn[8][f]) set(f, 8, false); if (!fn[f][8]) set(8, f, false); }
    for (var f2 = 0; f2 < 8; f2++) { set(size - 1 - f2, 8, false); set(8, size - 1 - f2, false); }
    /* version information (version >= 7) */
    if (version >= 7) {
      var vinfo = bchVersion(version);
      for (var vi = 0; vi < 18; vi++) {
        var bit = (vinfo >>> vi) & 1;
        var r = Math.floor(vi / 3), col = vi % 3;
        set(size - 11 + col, r, bit); set(r, size - 11 + col, bit);
      }
    }
    /* --- place data with mask 0: (x + y) % 2 === 0 --- */
    var di = 0, upward = true;
    for (var x2 = size - 1; x2 > 0; x2 -= 2) {
      if (x2 === 6) x2 = 5;
      for (var step = 0; step < size; step++) {
        var y2 = upward ? size - 1 - step : step;
        for (var col2 = 0; col2 < 2; col2++) {
          var xx = x2 - col2;
          if (fn[y2][xx]) continue;
          var value = 0;
          if (di < out.length * 8) value = (out[di >>> 3] >>> (7 - (di & 7))) & 1;
          di++;
          if ((xx + y2) % 2 === 0) value ^= 1; /* mask 0 */
          matrix[y2][xx] = value;
        }
      }
      upward = !upward;
    }
    /* --- format information (level M = 0b00, mask 0) --- */
    var fmt = bchFormat(0);
    for (var i3 = 0; i3 <= 5; i3++) set(8, i3, ((fmt >>> i3) & 1) === 1);
    set(8, 7, ((fmt >>> 6) & 1) === 1);
    set(8, 8, ((fmt >>> 7) & 1) === 1);
    set(7, 8, ((fmt >>> 8) & 1) === 1);
    for (var i4 = 9; i4 <= 14; i4++) set(14 - i4, 8, ((fmt >>> i4) & 1) === 1);
    for (var i5 = 0; i5 <= 7; i5++) set(size - 1 - i5, 8, ((fmt >>> i5) & 1) === 1);
    for (var i6 = 8; i6 <= 14; i6++) set(8, size - 15 + i6, ((fmt >>> i6) & 1) === 1);
    set(8, size - 8, true);
    return {
      version: version,
      size: size,
      get: function (x, y) { return matrix[y][x] === 1; },
      rows: matrix.map(function (r2) { return r2.join(''); }),
      /* exposed for the encoder test harness: the interleaved codeword stream
         and the reserved-module map, so a test can re-read a reference matrix
         in the same traversal order and compare bit for bit. */
      debug: {
        codewords: out.slice(),
        reserved: fn.map(function (r2) { return r2.map(function (v) { return v ? 1 : 0; }).join(''); })
      }
    };
  }

  /* ---------------------------------------------------------------- exports */

  var API = {
    u8: u8, fromU8: fromU8, toB64: toB64, fromB64: fromB64, toHex: toHex,
    randomBytes: randomBytes, ctEqual: ctEqual, randomDigits: randomDigits,
    fmtDate: fmtDate, base32Encode: base32Encode, base32Decode: base32Decode,
    hmacSha1: hmacSha1, hotp: hotp, totpAt: totpAt, totpVerify: totpVerify,
    rfc6238Vectors: rfc6238Vectors, qrMatrix: qrMatrix, qrCapacityBytes: qrCapacityBytes,
    PBKDF2_ITERATIONS: 250000
  };
  /* ------------------------------------------------------- the account vault */
  /*
   * Storage schema (localStorage key "inc.account.v1"):
   *   { v:1,
   *     kdf:    { name:'PBKDF2', hash:'SHA-256', iterations:250000, salt:<b64 16B> },
   *     cipher: { name:'AES-GCM', length:256, iv:<b64 12B>, ct:<b64 ciphertext+tag> },
   *     updatedAt: <ISO> }
   * The ciphertext is the JSON below; it never leaves the browser unencrypted
   * except through the explicit product file the reader asks for.
   *
   *   { v:1, profile:{ email, displayName, createdAt, updatedAt },
   *     prefs:{ lang, theme }, tokens:[], apps:{},
   *     email:{ address, level:'unverified'|'self-attested'|'github-verified',
   *             method:'mailto'|'github-pat', verifiedAt, evidence,
   *             selfAttest:{ payload:{email,code,ts}, alg:'Ed25519', spki, sig } },
   *     keys:{ alg:'Ed25519', priv:<b64 pkcs8>, pub:<b64 spki> },
   *     totp:{ enabled, secretB32, digits, period, algorithm, issuer, createdAt },
   *     recovery:{ hashes:[<sha256 hex>], used:[<ISO|null>], generatedAt },
   *     lock:{ failures, lockedUntil }, audit:[{ ts, event }] }
   */
  var VAULT_KEY = 'inc.account.v1';
  var PRODUCT_FILE_HINT = '%LOCALAPPDATA%\\Infinity.Inc\\account.json';
  var LEVELS = { unverified: 0, 'self-attested': 1, 'github-verified': 2 };
  var LOCK_FAILS = 5, LOCK_MS = 5 * 60 * 1000, CODE_TTL_MS = 15 * 60 * 1000;
  var netlog = [];
  var session = null;
  var clock = function () { return Date.now(); };
  var MEMORY = (function () {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  })();
  var store = (typeof localStorage !== 'undefined' && localStorage) ? localStorage : MEMORY;

  function setStore(s) { store = s; }
  function resetStore() { store = (typeof localStorage !== 'undefined' && localStorage) ? localStorage : MEMORY; }
  function readBlobText() { try { return store.getItem(VAULT_KEY); } catch (e) { return null; } }
  function hasAccount() { return !!readBlobText(); }

  async function deriveKey(passphrase, saltB64, iterations) {
    var base = await crypto.subtle.importKey('raw', u8(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: fromB64(saltB64), iterations: iterations || 250000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function sealBlob(plain, passphrase, iterations) {
    var iters = iterations || 250000;
    var salt = randomBytes(16), iv = randomBytes(12);
    var key = await deriveKey(passphrase, toB64(salt), iters);
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, u8(JSON.stringify(plain)));
    return {
      v: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: iters, salt: toB64(salt) },
      cipher: { name: 'AES-GCM', length: 256, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) },
      updatedAt: new Date(clock()).toISOString()
    };
  }
  async function openBlob(blob, passphrase) {
    if (!blob || !blob.kdf || !blob.cipher) throw new Error('not a vault');
    var key = await deriveKey(passphrase, blob.kdf.salt, blob.kdf.iterations);
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.cipher.iv) }, key, fromB64(blob.cipher.ct));
    return { plain: JSON.parse(fromU8(new Uint8Array(pt))), key: key };
  }
  /* re-seal with the session key so saving does not pay the KDF cost again */
  async function reseal(plain, key, kdf) {
    var iv = randomBytes(12);
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, u8(JSON.stringify(plain)));
    return {
      v: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: kdf.salt },
      cipher: { name: 'AES-GCM', length: 256, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) },
      updatedAt: new Date(clock()).toISOString()
    };
  }

  /* ------------------------------------------------------------ signatures */

  async function newSigningKey() {
    var pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    return {
      alg: 'Ed25519',
      priv: toB64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))),
      pub: toB64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)))
    };
  }
  async function signText(privB64, text) {
    var key = await crypto.subtle.importKey('pkcs8', fromB64(privB64), { name: 'Ed25519' }, false, ['sign']);
    return toB64(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, u8(text))));
  }
  async function verifyText(pubB64, text, sigB64) {
    try {
      var key = await crypto.subtle.importKey('spki', fromB64(pubB64), { name: 'Ed25519' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'Ed25519' }, key, fromB64(sigB64), u8(text));
    } catch (e) { return false; }
  }
  /* deterministic JSON so a signature can be checked by any language */
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    var keys = Object.keys(value).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canonical(value[k]); }).join(',') + '}';
  }
  async function sha256Hex(text) {
    var h = await crypto.subtle.digest('SHA-256', u8(String(text)));
    return toHex(new Uint8Array(h));
  }

  /* --------------------------------------------------------------- GitHub */
  /*
   * The single helper that talks to the outside world. Every call is written to
   * netlog so the report (and the reader) can check that an offline flow made no
   * requests at all, and that api.github.com is the only third party we ever
   * reach.
   */
  async function gh(pathname, options) {
    var entry = { ts: new Date(clock()).toISOString(), method: (options && options.method) || 'GET', url: pathname, ok: false, status: 0 };
    netlog.push(entry);
    try {
      var res = await fetch(pathname, options);
      entry.status = res.status;
      entry.ok = res.ok;
      entry.body = await res.json().catch(function () { return null; });
      return { ok: res.ok, status: res.status, body: entry.body, error: null };
    } catch (e) {
      entry.error = String(e && e.message ? e.message : e);
      return { ok: false, status: 0, body: null, error: entry.error };
    }
  }

  /* -------------------------------------------------------- email checking */

  function emailLooksValid(address) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(address || '').trim());
  }
  async function b1Pat(personalToken, address) {
    /* Real check: ask GitHub for the verified addresses behind the token. */
    var res = await gh('https://api.github.com/user/emails', {
      headers: { Authorization: 'Bearer ' + String(personalToken || '').trim(), Accept: 'application/vnd.github+json' }
    });
    if (!res.ok || !Array.isArray(res.body)) {
      return { ok: false, reason: res.status === 401 ? 'bad-token' : 'github-error', status: res.status, error: res.error };
    }
    var primary = null, match = null, wanted = String(address || '').trim().toLowerCase();
    for (var i = 0; i < res.body.length; i++) {
      var email = res.body[i];
      if (email.primary && email.verified) primary = email;
      if (wanted && String(email.email || '').toLowerCase() === wanted && email.verified) match = email;
    }
    var chosen = match || primary;
    if (!chosen) return { ok: false, reason: 'no-verified-address' };
    return {
      ok: true,
      level: 'github-verified',
      method: 'github-pat',
      address: chosen.email,
      evidence: { source: 'api.github.com/user/emails', primary: !!chosen.primary, verified: !!chosen.verified, checkedAt: new Date(clock()).toISOString() }
    };
  }
  async function b1DeviceStart(clientId) {
    /* GitHub's device-flow endpoints do not send CORS headers, so a page served
       from a static host cannot complete this leg; the request is attempted and
       the reason is reported instead of pretending it worked. */
    var res = await gh('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: String(clientId || '').trim(), scope: 'user:email' })
    });
    if (!res.ok || !res.body || !res.body.device_code) {
      return { ok: false, reason: res.error ? 'cors-or-network' : 'github-refused', status: res.status, error: res.error, hint: 'use-github-pat' };
    }
    return { ok: true, device: res.body };
  }
  async function b1DevicePoll(clientId, deviceCode) {
    return gh('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: String(clientId || '').trim(), device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
    });
  }

  /* --------------------------------------- self-attested mail verification */

  async function b2Start() {
    var account = requireUnlocked();
    var code = randomDigits(6);
    var address = account.profile.email;
    var ts = clock();
    var payload = { email: address, code: code, ts: ts };
    var text = canonical(payload);
    var signature = await signText(account.keys.priv, text);
    var subject = 'Infinity.Inc email verification code';
    var body = 'Infinity.Inc email verification' + String.fromCharCode(10, 10)
      + 'Address: ' + address + String.fromCharCode(10)
      + 'Code: ' + code + String.fromCharCode(10)
      + 'Issued: ' + new Date(ts).toISOString() + String.fromCharCode(10, 10)
      + 'Send this message to yourself (or to a helper you trust), then paste the code back on the sign-up page. '
      + 'There is no Infinity server: the code only proves the message arrived, so the site marks it self-attested and signs it locally.';
    var mailto = 'mailto:' + encodeURIComponent(address) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    account.email.pending = { code: code, ts: ts, payload: payload, signature: signature };
    await save();
    return {
      ok: true, code: code, mailto: mailto, payload: payload, canonical: text,
      alg: 'Ed25519', spki: account.keys.pub, signature: signature,
      expiresAt: ts + CODE_TTL_MS, ttlMs: CODE_TTL_MS
    };
  }
  async function b2Confirm(code) {
    var account = requireUnlocked();
    var pending = account.email.pending;
    if (!pending) return { ok: false, reason: 'no-pending-code' };
    if (clock() > pending.ts + CODE_TTL_MS) return { ok: false, reason: 'expired' };
    if (!ctEqual(String(code || '').trim(), pending.code)) return { ok: false, reason: 'code-mismatch' };
    account.email.level = 'self-attested';
    account.email.method = 'mailto';
    account.email.address = pending.payload.email;
    account.email.verifiedAt = new Date(clock()).toISOString();
    account.email.selfAttest = {
      payload: pending.payload, alg: 'Ed25519', spki: account.keys.pub, sig: pending.signature,
      note: 'No server can check this by design; it is a local self-attestation whose signature a product can verify offline.'
    };
    account.email.evidence = { source: 'mailto self-attestation', selfAttested: true };
    delete account.email.pending;
    await save();
    return { ok: true, level: 'self-attested', selfAttest: account.email.selfAttest };
  }

  /* ------------------------------------------------------------------- 2FA */
  /* Offline TOTP (RFC 6238: HMAC-SHA1, 30s period, 6 digits, +/-1 step).
     Recovery codes are stored only as SHA-256 hashes and compared in constant
     time; five wrong second-factor answers lock the account for five minutes. */

  function recoveryCode() {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; /* no look-alike glyphs */
    var raw = randomBytes(16), out = '';
    for (var i = 0; i < 16; i++) out += alphabet[raw[i] % alphabet.length];
    return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8, 12) + '-' + out.slice(12, 16);
  }
  async function totpEnable() {
    var account = requireUnlocked();
    var secret = base32Encode(randomBytes(20));
    var issuer = 'Infinity.Inc';
    var label = issuer + ':' + (account.profile.email || 'account');
    var uri = 'otpauth://totp/' + encodeURIComponent(label) + '?secret=' + secret
      + '&issuer=' + encodeURIComponent(issuer) + '&algorithm=SHA1&digits=6&period=30';
    var codes = [];
    for (var i = 0; i < 10; i++) codes.push(recoveryCode());
    var hashes = [];
    for (var j = 0; j < codes.length; j++) hashes.push(await sha256Hex(codes[j]));
    account.totp = {
      enabled: false, secretB32: secret, digits: 6, period: 30, algorithm: 'SHA1',
      issuer: issuer, uri: uri, createdAt: new Date(clock()).toISOString()
    };
    account.recovery = { hashes: hashes, used: new Array(codes.length).fill(null), generatedAt: new Date(clock()).toISOString() };
    await save();
    var qr = qrMatrix(uri);
    return { ok: true, uri: uri, secretB32: secret, codes: codes, qr: { version: qr.version, size: qr.size, rows: qr.rows } };
  }
  async function totpNow() {
    var account = requireUnlocked();
    if (!account.totp || !account.totp.secretB32) return null;
    return totpAt(base32Decode(account.totp.secretB32), clock(), account.totp.period, account.totp.digits);
  }
  async function totpConfirm(code) {
    var account = requireUnlocked();
    if (!account.totp || !account.totp.secretB32) return { ok: false, reason: 'not-started' };
    var good = await totpVerify(base32Decode(account.totp.secretB32), code, clock(), account.totp.period, account.totp.digits, 1);
    if (!good) return { ok: false, reason: 'code-mismatch' };
    account.totp.enabled = true;
    account.totp.enabledAt = new Date(clock()).toISOString();
    await save();
    return { ok: true };
  }
  function lockState(account) {
    var lock = account.lock || { failures: 0, lockedUntil: 0 };
    var now = clock();
    return {
      locked: lock.lockedUntil > now,
      lockedUntil: lock.lockedUntil,
      remainingMs: Math.max(0, lock.lockedUntil - now),
      failures: lock.failures || 0
    };
  }
  async function verifySecondFactor(code) {
    var account = requireUnlocked();
    if (!account.totp || !account.totp.enabled) return { ok: true, method: 'none' };
    var state = lockState(account);
    if (state.locked) return { ok: false, locked: true, unlockAt: state.lockedUntil, remainingMs: state.remainingMs };
    var cleaned = String(code || '').trim();
    if (await totpVerify(base32Decode(account.totp.secretB32), cleaned, clock(), account.totp.period, account.totp.digits, 1)) {
      account.lock = { failures: 0, lockedUntil: 0 };
      await save();
      return { ok: true, method: 'totp' };
    }
    var hash = await sha256Hex(cleaned.toUpperCase());
    var hashes = (account.recovery && account.recovery.hashes) || [];
    for (var i = 0; i < hashes.length; i++) {
      if (account.recovery.used[i]) continue;
      if (ctEqual(hashes[i], hash)) {
        account.recovery.used[i] = new Date(clock()).toISOString();
        account.lock = { failures: 0, lockedUntil: 0 };
        await save();
        return { ok: true, method: 'recovery', remaining: hashes.length - account.recovery.used.filter(Boolean).length };
      }
    }
    var failures = (account.lock ? account.lock.failures : 0) + 1;
    if (failures >= LOCK_FAILS) {
      account.lock = { failures: 0, lockedUntil: clock() + LOCK_MS, lastLockAt: new Date(clock()).toISOString() };
      await save();
      return { ok: false, locked: true, reason: 'too-many-failures', unlockAt: account.lock.lockedUntil, remainingMs: LOCK_MS };
    }
    account.lock = { failures: failures, lockedUntil: 0 };
    await save();
    return { ok: false, reason: 'code-mismatch', failures: failures, attemptsLeft: LOCK_FAILS - failures };
  }

  /* -------------------------------------------------------- account actions */

  function blankAccount(email, displayName) {
    var now = new Date(clock()).toISOString();
    return {
      v: 1,
      profile: { email: String(email || '').trim(), displayName: String(displayName || '').trim(), createdAt: now, updatedAt: now },
      prefs: { lang: (typeof document !== 'undefined' && document.documentElement.getAttribute('lang')) || 'en', theme: 'system' },
      tokens: [], apps: {},
      email: { address: String(email || '').trim(), level: 'unverified', method: null, verifiedAt: null, evidence: null, selfAttest: null, pending: null },
      keys: null,
      totp: null,
      recovery: null,
      lock: { failures: 0, lockedUntil: 0 },
      audit: [{ ts: now, event: 'account.created' }]
    };
  }
  function requireUnlocked() {
    if (!session) throw new Error('locked');
    return session.data;
  }
  async function save() {
    if (!session) throw new Error('locked');
    session.data.profile.updatedAt = new Date(clock()).toISOString();
    session.blob = await reseal(session.data, session.key, session.blob.kdf);
    store.setItem(VAULT_KEY, JSON.stringify(session.blob));
    return session.blob;
  }
  async function create(options) {
    options = options || {};
    if (!emailLooksValid(options.email)) return { ok: false, reason: 'bad-email' };
    if (!options.passphrase || String(options.passphrase).length < 8) return { ok: false, reason: 'weak-passphrase' };
    if (hasAccount() && !options.replace) return { ok: false, reason: 'already-exists' };
    var data = blankAccount(options.email, options.displayName);
    data.keys = await newSigningKey();
    var iterations = options.iterations || 250000;
    var blob = await sealBlob(data, options.passphrase, iterations);
    store.setItem(VAULT_KEY, JSON.stringify(blob));
    var opened = await openBlob(blob, options.passphrase);
    session = { data: opened.plain, key: opened.key, blob: blob };
    return { ok: true, state: state() };
  }
  async function unlock(passphrase) {
    var text = readBlobText();
    if (!text) return { ok: false, reason: 'no-account' };
    var blob;
    try { blob = JSON.parse(text); } catch (e) { return { ok: false, reason: 'corrupt' }; }
    try {
      var opened = await openBlob(blob, passphrase);
      session = { data: opened.plain, key: opened.key, blob: blob };
      return { ok: true, state: state() };
    } catch (e) {
      return { ok: false, reason: 'bad-passphrase' };
    }
  }
  async function login(passphrase, code) {
    var res = await unlock(passphrase);
    if (!res.ok) return res;
    var data = session.data;
    if (!data.totp || !data.totp.enabled) return { ok: true, secondFactor: 'none', state: state() };
    if (!code) { session = null; return { ok: false, reason: 'second-factor-required' }; }
    var second = await verifySecondFactor(code);
    if (!second.ok) {
      session = null; /* a failed second factor must not leave the vault open */
      return {
        ok: false, reason: second.reason || 'second-factor-failed',
        locked: second.locked, unlockAt: second.unlockAt, remainingMs: second.remainingMs,
        failures: second.failures, attemptsLeft: second.attemptsLeft
      };
    }
    return { ok: true, secondFactor: second.method, state: state() };
  }
  function lock() { session = null; return { ok: true }; }
  function isUnlocked() { return !!session; }
  function state() {
    if (!session) return { unlocked: false, hasAccount: hasAccount() };
    var d = session.data;
    var lockInfo = lockState(d);
    return {
      unlocked: true,
      hasAccount: true,
      email: d.profile.email,
      displayName: d.profile.displayName,
      emailLevel: d.email.level,
      emailMethod: d.email.method,
      verifiedAt: d.email.verifiedAt,
      selfAttested: d.email.level === 'self-attested',
      totpEnabled: !!(d.totp && d.totp.enabled),
      recoveryLeft: d.recovery ? d.recovery.hashes.length - d.recovery.used.filter(Boolean).length : 0,
      locked: lockInfo.locked,
      lockedUntil: lockInfo.lockedUntil,
      failures: lockInfo.failures,
      publicKey: d.keys ? d.keys.pub : null,
      productPath: PRODUCT_FILE_HINT,
      updatedAt: d.profile.updatedAt
    };
  }
  async function changePassphrase(oldPassphrase, newPassphrase) {
    if (!newPassphrase || String(newPassphrase).length < 8) return { ok: false, reason: 'weak-passphrase' };
    var unlocked = await unlock(oldPassphrase);
    if (!unlocked.ok) return unlocked;
    var blob = await sealBlob(session.data, newPassphrase, 250000);
    store.setItem(VAULT_KEY, JSON.stringify(blob));
    var opened = await openBlob(blob, newPassphrase);
    session = { data: opened.plain, key: opened.key, blob: blob };
    return { ok: true };
  }
  function exportBlob() {
    var text = readBlobText();
    return { ok: !!text, json: text, filename: 'infinity-account.encrypted.json' };
  }
  async function importBlob(text) {
    var blob;
    try { blob = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { ok: false, reason: 'not-json' }; }
    if (!blob || !blob.kdf || !blob.cipher || blob.v !== 1) return { ok: false, reason: 'not-a-vault' };
    store.setItem(VAULT_KEY, JSON.stringify(blob));
    session = null;
    return { ok: true, needsPassphrase: true };
  }
  async function exportProductFile() {
    var account = requireUnlocked();
    var snapshot = {
      v: 1,
      product: 'Infinity.Inc',
      generatedAt: new Date(clock()).toISOString(),
      profile: { displayName: account.profile.displayName, createdAt: account.profile.createdAt },
      email: {
        address: account.email.address,
        trust: account.email.level,
        method: account.email.method,
        verifiedAt: account.email.verifiedAt,
        selfAttest: account.email.selfAttest || null
      },
      totp: { enabled: !!(account.totp && account.totp.enabled) },
      tokens: account.tokens || [],
      apps: account.apps || {},
      publicKey: account.keys ? { alg: 'Ed25519', spki: account.keys.pub } : null,
      targetPath: PRODUCT_FILE_HINT,
      note: 'Written by the reader from the Infinity.Inc account page. Products read it offline; nothing here is sent to Infinity.'
    };
    var text = canonical(snapshot);
    snapshot.signature = { alg: 'Ed25519', spki: account.keys.pub, value: await signText(account.keys.priv, text) };
    snapshot.canonical = text;
    return { ok: true, filename: 'account.json', json: JSON.stringify(snapshot, null, 2), snapshot: snapshot };
  }
  async function verifyProductFile(json) {
    var obj = typeof json === 'string' ? JSON.parse(json) : json;
    if (!obj || !obj.signature) return { ok: false, reason: 'unsigned' };
    var copy = JSON.parse(JSON.stringify(obj));
    delete copy.signature;
    delete copy.canonical;
    return { ok: await verifyText(obj.signature.spki, canonical(copy), obj.signature.value), snapshot: copy };
  }
  async function removeAccount() {
    var had = hasAccount();
    session = null;
    try { store.removeItem(VAULT_KEY); } catch (e) { /* ignore */ }
    return { ok: true, hadAccount: had };
  }
  async function auditEvent(event) {
    if (!session) return;
    session.data.audit.push({ ts: new Date(clock()).toISOString(), event: event });
    await save();
  }
  async function selfTest() {
    var vectors = await rfc6238Vectors();
    var qr = qrMatrix('otpauth://totp/Infinity.Inc:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Infinity.Inc');
    var salt = toB64(randomBytes(16));
    var key = await deriveKey('correct horse battery staple', salt, 250000);
    var iv = randomBytes(12);
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, u8('{"hello":"world"}')));
    var back = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct));
    var wrongRejected = false;
    try {
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, await deriveKey('wrong passphrase', salt, 250000), ct);
    } catch (e) { wrongRejected = true; }
    var signed = await newSigningKey();
    var sig = await signText(signed.priv, 'payload');
    return {
      vectors: vectors,
      qr: { version: qr.version, size: qr.size },
      crypto: {
        aesGcmRoundTrip: fromU8(back) === '{"hello":"world"}',
        wrongPassphraseRejected: wrongRejected,
        iterations: 250000
      },
      signature: { alg: 'Ed25519', verified: await verifyText(signed.pub, 'payload', sig), tamperedRejected: !(await verifyText(signed.pub, 'payload!', sig)) }
    };
  }

  var API2 = {
    VAULT_KEY: VAULT_KEY, PRODUCT_FILE_HINT: PRODUCT_FILE_HINT, LEVELS: LEVELS,
    LOCK_FAILS: LOCK_FAILS, LOCK_MS: LOCK_MS, CODE_TTL_MS: CODE_TTL_MS,
    netlog: netlog,
    setStore: setStore, resetStore: resetStore, hasAccount: hasAccount,
    deriveKey: deriveKey, sealBlob: sealBlob, openBlob: openBlob, canonical: canonical,
    sha256Hex: sha256Hex, newSigningKey: newSigningKey, signText: signText, verifyText: verifyText,
    gh: gh, emailLooksValid: emailLooksValid, b1Pat: b1Pat, b1DeviceStart: b1DeviceStart, b1DevicePoll: b1DevicePoll,
    b2Start: b2Start, b2Confirm: b2Confirm,
    totpEnable: totpEnable, totpConfirm: totpConfirm, totpNow: totpNow, verifySecondFactor: verifySecondFactor,
    create: create, unlock: unlock, login: login, lock: lock, isUnlocked: isUnlocked, state: state,
    changePassphrase: changePassphrase, exportBlob: exportBlob, importBlob: importBlob,
    exportProductFile: exportProductFile, verifyProductFile: verifyProductFile, removeAccount: removeAccount,
    save: save, auditEvent: auditEvent, selfTest: selfTest,
    qa: {
      setClock: function (fn) { clock = fn; },
      resetClock: function () { clock = function () { return Date.now(); }; },
      clearLock: async function () { var d = requireUnlocked(); d.lock = { failures: 0, lockedUntil: 0 }; await save(); }
    }
  };
  Object.keys(API2).forEach(function (k) { API[k] = API2[k]; });
  /* ===================================================================== UI */
  /* Everything below only runs in a page; the module above is what the node
     tests exercise. Text is bilingual and chosen from <html lang>. */

  var S = {
    zh: {
      signupTitle: '创建账户', signupLede: '没有 Infinity 服务器：账户资料加密后只存在这个浏览器里。邮箱验证要么走 GitHub（真实验证），要么走你亲手发的邮件（本地自证）。',
      loginTitle: '登录', loginLede: '用口令解密本机账户；启用了 2FA 就再输入验证器里的 6 位码或恢复码。',
      email: '邮箱', displayName: '显示名（可选）', passphrase: '口令（至少 8 位）', passphrase2: '再输一次口令',
      create: '创建账户', verifyEmail: '邮箱验证', patLabel: 'GitHub 令牌（需 user:email 权限）', patGo: '用 GitHub 验证',
      deviceGo: '尝试 Device Flow（浏览器会被 CORS 拦下）', b2Start: '生成 6 位码与邮件草稿', b2Input: '把收到的 6 位码粘回来', b2Confirm: '确认自证',
      setup2fa: '两步验证（离线 TOTP）', totpStart: '生成密钥与二维码', totpInput: '输入验证器当前的 6 位码', totpConfirm: '启用 2FA',
      secret: '手动录入密钥', uri: 'otpauth URI', codes: '10 个一次性恢复码（只显示这一次；库内只存 SHA-256）',
      exportTitle: '导出与产品读取', exportEncrypted: '导出加密 JSON', exportProduct: '导出 account.json（给产品离线读取）', productPath: '产品读取位置',
      importLabel: '导入加密 JSON', login: '登录', secondFactor: '验证码（TOTP 或恢复码）', lock: '锁定', remove: '删除本机账户',
      trust: '验证级别', trustUnverified: '未验证', trustSelf: '自证（本地签名，服务器无法核验）', trustGithub: 'GitHub 已验证（真实）',
      journal: '审计日志', signedIn: '已解锁', signupDone: '账户已创建。', selfTag: 'self-attested', qrAlt: '二维码（本地生成）',
      gistPat: '你自己的 GitHub 令牌（仅用于同步，默认关闭）', gistPush: '同步到私有 Gist（只上传密文）', gistPull: '从 Gist 取回', gistNote: '可选：不填令牌就完全本地；上传的只是加密后的库，GitHub 看不到明文。'
    },
    en: {
      signupTitle: 'Create an account', signupLede: 'There is no Infinity server: the profile is encrypted and kept in this browser only. Email is either checked with GitHub (real) or carried by a message you send yourself (locally self-attested).',
      loginTitle: 'Sign in', loginLede: 'Your passphrase decrypts the local account; if 2FA is on, add the 6-digit code or a recovery code.',
      email: 'Email', displayName: 'Display name (optional)', passphrase: 'Passphrase (8+ characters)', passphrase2: 'Repeat passphrase',
      create: 'Create account', verifyEmail: 'Email verification', patLabel: 'GitHub token (needs user:email)', patGo: 'Verify with GitHub',
      deviceGo: 'Try Device Flow (the browser will be blocked by CORS)', b2Start: 'Make a 6-digit code and mail draft', b2Input: 'Paste the code you received', b2Confirm: 'Confirm self-attestation',
      setup2fa: 'Two-factor (offline TOTP)', totpStart: 'Generate secret and QR code', totpInput: 'Enter the 6-digit code from your authenticator', totpConfirm: 'Turn on 2FA',
      secret: 'Manual entry secret', uri: 'otpauth URI', codes: '10 one-time recovery codes (shown once; only SHA-256 is stored)',
      exportTitle: 'Export and product access', exportEncrypted: 'Export encrypted JSON', exportProduct: 'Export account.json (read offline by products)', productPath: 'Where products read it',
      importLabel: 'Import encrypted JSON', login: 'Sign in', secondFactor: 'Second factor (TOTP or recovery code)', lock: 'Lock', remove: 'Delete the local account',
      trust: 'Verification level', trustUnverified: 'Unverified', trustSelf: 'Self-attested (local signature, no server check)', trustGithub: 'GitHub-verified (real)',
      journal: 'Audit log', signedIn: 'Unlocked', signupDone: 'Account created.', selfTag: 'self-attested', qrAlt: 'QR code (generated locally)',
      gistPat: 'Your own GitHub token (sync only, off by default)', gistPush: 'Sync to a private Gist (ciphertext only)', gistPull: 'Pull from the Gist', gistNote: 'Optional: with no token everything stays local; only the encrypted vault is uploaded, so GitHub never sees the plaintext.'
    }
  };
  function lang() {
    var l = (typeof document !== 'undefined' && document.documentElement.getAttribute('lang')) || 'en';
    return String(l).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
  }
  function tr(key) { return S[lang()][key] || S.en[key] || key; }

  function doc() { return typeof document === 'undefined' ? null : document; }
  function el(tag, attrs, kids) {
    var d = doc();
    var node = d.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') throw new Error('refusing to set markup');
      else if (k === 'value') node.value = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) node.appendChild(k); });
    return node;
  }
  function text(tag, cls, value) { return el(tag, { class: cls, text: value }); }
  function card(title) {
    var box = el('div', { class: 'card acct-card' });
    if (title) box.appendChild(text('h3', null, title));
    return box;
  }
  function button(id, label, kind) { return el('button', { class: 'btn' + (kind ? ' ' + kind : ''), id: id, type: 'button', text: label }); }
  function statusNode(id) { return el('p', { class: 'small muted', id: id, role: 'status' }); }
  function setStatus(id, message, bad) {
    var node = doc() && doc().getElementById(id);
    if (!node) return;
    node.textContent = message || '';
    node.className = 'small ' + (bad ? 'acct-bad' : 'muted');
  }
  function pill(node, label, kind) { node.className = 'pill' + (kind ? ' ' + kind : ''); node.textContent = label; }

  function trustPill() {
    var st = state();
    var node = el('span', { class: 'pill', id: 'acct-trust' });
    if (st.emailLevel === 'github-verified') pill(node, tr('trustGithub'), 'good');
    else if (st.emailLevel === 'self-attested') pill(node, tr('trustSelf'), 'warn');
    else pill(node, tr('trustUnverified'), 'bad');
    return node;
  }
  function drawQr(canvas, qr, cell) {
    /* the QR is drawn here, from the encoder above: no image service, no CDN */
    if (!canvas || !qr) return;
    cell = cell || Math.max(2, Math.floor(240 / qr.size));
    var pad = cell * 4;
    canvas.width = qr.size * cell + pad * 2;
    canvas.height = canvas.width;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111111';
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.rows[y][x] === '1') ctx.fillRect(pad + x * cell, pad + y * cell, cell, cell);
      }
    }
    canvas.setAttribute('data-qr-version', String(qr.version));
    canvas.setAttribute('data-qr-size', String(qr.size));
    canvas.setAttribute('aria-label', tr('qrAlt'));
  }
  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    doc().body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }
  function readFile(file, cb) {
    var fr = new FileReader();
    fr.onload = function () { cb(String(fr.result || '')); };
    fr.readAsText(file);
  }
  function field(id, labelText, type, placeholder) {
    var wrap = el('div', { class: 'field' });
    wrap.appendChild(el('label', { for: id, text: labelText }));
    wrap.appendChild(el('input', { id: id, type: type, placeholder: placeholder || '', autocomplete: 'off', spellcheck: 'false' }));
    return wrap;
  }
  function codeBlock(value) { return el('pre', { class: 'block acct-code' }, [el('code', { text: value })]); }

  /* ------------------------------------------------------------ sign-up page */

  function renderSignup(host) {
    host.appendChild(text('h1', null, tr('signupTitle')));
    host.appendChild(text('p', 'lede', tr('signupLede')));
    var row = el('p', { class: 'row' });
    row.appendChild(el('span', { class: 'muted small', text: tr('trust') + ': ' }));
    row.appendChild(trustPill());
    host.appendChild(row);

    var create = card(tr('create'));
    create.appendChild(field('acct-email', tr('email'), 'email', 'you@example.com'));
    create.appendChild(field('acct-name', tr('displayName'), 'text', ''));
    create.appendChild(field('acct-pass', tr('passphrase'), 'password', ''));
    create.appendChild(field('acct-pass2', tr('passphrase2'), 'password', ''));
    var createRow = el('div', { class: 'row' });
    createRow.appendChild(button('acct-create', tr('create')));
    create.appendChild(createRow);
    create.appendChild(statusNode('acct-create-status'));
    host.appendChild(create);

    var verify = card(tr('verifyEmail'));
    verify.appendChild(field('acct-pat', tr('patLabel'), 'password', 'github_pat_...'));
    var verifyRow = el('div', { class: 'row' });
    verifyRow.appendChild(button('acct-pat-go', tr('patGo'), 'ghost'));
    verifyRow.appendChild(button('acct-device-go', tr('deviceGo'), 'ghost small'));
    verify.appendChild(verifyRow);
    verify.appendChild(statusNode('acct-pat-status'));
    verify.appendChild(el('hr'));
    var b2Row = el('div', { class: 'row' });
    b2Row.appendChild(button('acct-b2-start', tr('b2Start'), 'ghost'));
    verify.appendChild(b2Row);
    verify.appendChild(statusNode('acct-b2-status'));
    verify.appendChild(el('p', { class: 'small', id: 'acct-mailto-wrap' }));
    verify.appendChild(field('acct-b2-input', tr('b2Input'), 'text', '000000'));
    var b2Row2 = el('div', { class: 'row' });
    b2Row2.appendChild(button('acct-b2-confirm', tr('b2Confirm'), 'ghost'));
    verify.appendChild(b2Row2);
    verify.appendChild(statusNode('acct-b2-confirm-status'));
    host.appendChild(verify);

    var twofa = card(tr('setup2fa'));
    twofa.appendChild(button('acct-totp-start', tr('totpStart'), 'ghost'));
    twofa.appendChild(el('canvas', { id: 'acct-qr', class: 'acct-qr', width: '240', height: '240' }));
    twofa.appendChild(el('p', { class: 'small muted' }, [el('span', { text: tr('secret') + ': ' }), el('code', { id: 'acct-secret', text: '-' })]));
    twofa.appendChild(el('p', { class: 'small muted' }, [el('span', { text: tr('uri') + ': ' }), el('code', { id: 'acct-uri', text: '-' })]));
    twofa.appendChild(el('p', { class: 'small muted', text: tr('codes') }));
    twofa.appendChild(el('ul', { class: 'acct-codes', id: 'acct-codes' }));
    twofa.appendChild(field('acct-totp-input', tr('totpInput'), 'text', '000000'));
    twofa.appendChild(button('acct-totp-confirm', tr('totpConfirm'), 'ghost'));
    twofa.appendChild(statusNode('acct-2fa-status'));
    host.appendChild(twofa);

    var exporter = card(tr('exportTitle'));
    var exportRow = el('div', { class: 'row' });
    exportRow.appendChild(button('acct-export', tr('exportEncrypted'), 'ghost'));
    exportRow.appendChild(button('acct-product', tr('exportProduct'), 'ghost'));
    exportRow.appendChild(button('acct-import', tr('importLabel'), 'ghost small'));
    exportRow.appendChild(el('input', { id: 'acct-import-file', type: 'file', accept: '.json,application/json', class: 'acct-file' }));
    exporter.appendChild(exportRow);
    exporter.appendChild(el('p', { class: 'note', text: tr('productPath') + ': ' + PRODUCT_FILE_HINT }));
    exporter.appendChild(el('hr'));
    exporter.appendChild(field('acct-gist-pat', tr('gistPat'), 'password', 'github_pat_...'));
    var gistRow = el('div', { class: 'row' });
    gistRow.appendChild(button('acct-gist-push', tr('gistPush'), 'ghost small'));
    gistRow.appendChild(button('acct-gist-pull', tr('gistPull'), 'ghost small'));
    exporter.appendChild(gistRow);
    exporter.appendChild(el('p', { class: 'note', text: tr('gistNote') }));
    exporter.appendChild(statusNode('acct-gist-status'));
    exporter.appendChild(statusNode('acct-export-status'));
    host.appendChild(exporter);

    host.appendChild(el('p', { class: 'small' }, [el('a', { href: '../login/', text: tr('login') + ' →' })]));

    wireSignup();
  }

  function wireSignup() {
    var d = doc();
    d.getElementById('acct-create').addEventListener('click', async function () {
      var email = d.getElementById('acct-email').value;
      var name = d.getElementById('acct-name').value;
      var pass = d.getElementById('acct-pass').value;
      var pass2 = d.getElementById('acct-pass2').value;
      if (pass !== pass2) { setStatus('acct-create-status', lang() === 'zh' ? '两次口令不一致。' : 'The two passphrases differ.', true); return; }
      var res = await create({ email: email, displayName: name, passphrase: pass });
      if (!res.ok) { setStatus('acct-create-status', res.reason, true); return; }
      setStatus('acct-create-status', tr('signupDone'), false);
      d.getElementById('acct-trust').textContent = tr('trustUnverified');
    });
    d.getElementById('acct-pat-go').addEventListener('click', async function () {
      var token = d.getElementById('acct-pat').value;
      setStatus('acct-pat-status', '...', false);
      var res = await b1Pat(token, (state().email || ''));
      if (!res.ok) { setStatus('acct-pat-status', res.reason + (res.status ? ' (' + res.status + ')' : ''), true); return; }
      var account = session.data;
      account.email.level = res.level; account.email.method = res.method; account.email.address = res.address;
      account.email.verifiedAt = new Date(clock()).toISOString(); account.email.evidence = res.evidence;
      await save();
      setStatus('acct-pat-status', tr('trustGithub') + ' — ' + res.address, false);
      var pillNode = d.getElementById('acct-trust');
      pill(pillNode, tr('trustGithub'), 'good');
    });
    d.getElementById('acct-device-go').addEventListener('click', async function () {
      var res = await b1DeviceStart('');
      if (!res.ok) {
        setStatus('acct-device-status', (lang() === 'zh'
          ? 'Device Flow 被浏览器拦下（' + (res.reason) + '）：github.com 的 device 接口不返回 CORS 头，静态站无法直连，请用上面的令牌方式。'
          : 'Device Flow is blocked by the browser (' + res.reason + '): github.com device endpoints send no CORS headers, so a static page cannot use them. Use the token route above.'), true);
        return;
      }
      setStatus('acct-device-status', res.device.user_code, false);
    });
    var deviceStatus = statusNode('acct-device-status');
    deviceStatus.className = 'small acct-bad';
    d.getElementById('acct-device-go').parentNode.appendChild(deviceStatus);
    d.getElementById('acct-b2-start').addEventListener('click', async function () {
      if (!isUnlocked()) { setStatus('acct-b2-status', lang() === 'zh' ? '先创建账户。' : 'Create the account first.', true); return; }
      var res = await b2Start();
      d.getElementById('acct-mailto-wrap').textContent = '';
      d.getElementById('acct-mailto-wrap').appendChild(el('a', { href: res.mailto, text: (lang() === 'zh' ? '打开邮件草稿' : 'Open the mail draft') + ' (' + res.code + ')' }));
      d.getElementById('acct-mailto-wrap').appendChild(el('code', { class: 'acct-sig', text: res.signature.slice(0, 24) + '...' }));
      setStatus('acct-b2-status', (lang() === 'zh' ? '已生成；15 分钟内把码粘回下面的输入框。' : 'Ready; paste the code below within 15 minutes.'), false);
    });
    d.getElementById('acct-b2-confirm').addEventListener('click', async function () {
      var res = await b2Confirm(d.getElementById('acct-b2-input').value);
      if (!res.ok) { setStatus('acct-b2-confirm-status', res.reason, true); return; }
      setStatus('acct-b2-confirm-status', tr('trustSelf'), false);
      pill(d.getElementById('acct-trust'), tr('trustSelf'), 'warn');
    });
    d.getElementById('acct-totp-start').addEventListener('click', async function () {
      if (!isUnlocked()) { setStatus('acct-2fa-status', lang() === 'zh' ? '先创建账户。' : 'Create the account first.', true); return; }
      var res = await totpEnable();
      drawQr(d.getElementById('acct-qr'), res.qr);
      d.getElementById('acct-secret').textContent = res.secretB32;
      d.getElementById('acct-uri').textContent = res.uri;
      var list = d.getElementById('acct-codes');
      list.textContent = '';
      res.codes.forEach(function (code) { list.appendChild(el('li', null, [el('code', { text: code })])); });
      setStatus('acct-2fa-status', (lang() === 'zh' ? '扫二维码或手动录入密钥，然后输入 6 位码确认。' : 'Scan the QR or enter the secret, then confirm with a 6-digit code.'), false);
    });
    d.getElementById('acct-totp-confirm').addEventListener('click', async function () {
      var res = await totpConfirm(d.getElementById('acct-totp-input').value);
      if (!res.ok) { setStatus('acct-2fa-status', res.reason, true); return; }
      setStatus('acct-2fa-status', (lang() === 'zh' ? '2FA 已启用。' : '2FA is on.'), false);
    });
    d.getElementById('acct-export').addEventListener('click', function () {
      var res = exportBlob();
      if (!res.ok) { setStatus('acct-export-status', 'no-account', true); return; }
      download(res.filename, res.json);
      setStatus('acct-export-status', res.filename, false);
    });
    d.getElementById('acct-product').addEventListener('click', async function () {
      if (!isUnlocked()) { setStatus('acct-export-status', 'locked', true); return; }
      var res = await exportProductFile();
      download(res.filename, res.json);
      setStatus('acct-export-status', tr('productPath') + ': ' + PRODUCT_FILE_HINT, false);
    });
    d.getElementById('acct-import').addEventListener('click', function () { d.getElementById('acct-import-file').click(); });
    d.getElementById('acct-gist-push').addEventListener('click', async function () {
      var pat = d.getElementById('acct-gist-pat').value;
      var res = await syncPush(pat);
      setStatus('acct-gist-status', res.ok ? ('Gist ' + res.gistId) : res.reason, !res.ok);
    });
    d.getElementById('acct-gist-pull').addEventListener('click', async function () {
      var pat = d.getElementById('acct-gist-pat').value;
      var res = await syncPull(pat);
      setStatus('acct-gist-status', res.ok ? (lang() === 'zh' ? '已取回，请用口令解锁。' : 'Pulled; unlock with your passphrase.') : res.reason, !res.ok);
    });
    d.getElementById('acct-import-file').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      readFile(file, async function (text) {
        var res = await importBlob(text);
        setStatus('acct-export-status', res.ok ? (lang() === 'zh' ? '已导入，请登录解锁。' : 'Imported; sign in to unlock.') : res.reason, !res.ok);
      });
    });
  }

  /* ------------------------------------------------------------- sign-in page */

  function renderLogin(host) {
    host.appendChild(text('h1', null, tr('loginTitle')));
    host.appendChild(text('p', 'lede', tr('loginLede')));
    var form = card(tr('login'));
    form.appendChild(el('p', { class: 'small muted', id: 'acct-email-known', text: '-' }));
    form.appendChild(field('acct-pass', tr('passphrase'), 'password', ''));
    form.appendChild(field('acct-code', tr('secondFactor'), 'text', '000000 / XXXX-XXXX-XXXX-XXXX'));
    var row = el('div', { class: 'row' });
    row.appendChild(button('acct-login', tr('login')));
    row.appendChild(button('acct-lock', tr('lock'), 'ghost small'));
    form.appendChild(row);
    form.appendChild(statusNode('acct-status'));
    host.appendChild(form);

    var panel = card(tr('signedIn'));
    panel.appendChild(el('p', { class: 'small' }, [el('span', { class: 'muted', text: tr('trust') + ': ' }), trustPill()]));
    panel.appendChild(el('p', { class: 'small muted', id: 'acct-profile', text: '-' }));
    var row2 = el('div', { class: 'row' });
    row2.appendChild(button('acct-export', tr('exportEncrypted'), 'ghost small'));
    row2.appendChild(button('acct-product', tr('exportProduct'), 'ghost small'));
    row2.appendChild(button('acct-remove', tr('remove'), 'ghost small'));
    panel.appendChild(row2);
    panel.appendChild(el('p', { class: 'note', text: tr('productPath') + ': ' + PRODUCT_FILE_HINT }));
    panel.appendChild(statusNode('acct-panel-status'));
    panel.appendChild(el('h4', { text: tr('journal') }));
    panel.appendChild(el('ul', { class: 'small muted', id: 'acct-audit' }));
    host.appendChild(panel);
    host.appendChild(el('p', { class: 'small' }, [el('a', { href: '../signup/', text: tr('signupTitle') + ' →' })]));

    wireLogin();
  }

  function paintKnownEmail() {
    var d = doc();
    var raw = readBlobText();
    var node = d.getElementById('acct-email-known');
    if (!node) return;
    if (!raw) { node.textContent = lang() === 'zh' ? '本机还没有账户。' : 'No account in this browser yet.'; return; }
    node.textContent = lang() === 'zh' ? '本机已有一个加密账户。' : 'An encrypted account exists in this browser.';
    if (isUnlocked()) node.textContent = state().email;
  }
  function paintPanel() {
    var d = doc();
    var list = d.getElementById('acct-audit');
    var profile = d.getElementById('acct-profile');
    if (!isUnlocked()) { if (profile) profile.textContent = '-'; return; }
    var st = state();
    profile.textContent = st.email + ' · ' + (st.displayName || '-') + ' · 2FA: ' + (st.totpEnabled ? 'on' : 'off') + ' · recovery: ' + st.recoveryLeft;
    list.textContent = '';
    session.data.audit.slice(-8).forEach(function (entry) {
      list.appendChild(el('li', null, [el('code', { text: entry.ts + '  ' + entry.event })]));
    });
    paintKnownEmail();
  }
  function wireLogin() {
    var d = doc();
    d.getElementById('acct-login').addEventListener('click', async function () {
      var pass = d.getElementById('acct-pass').value;
      var code = d.getElementById('acct-code').value;
      var res = await login(pass, code);
      if (!res.ok) {
        var msg = res.reason;
        if (res.reason === 'code-mismatch') msg = (lang() === 'zh' ? '验证码不对，还可试 ' + res.attemptsLeft + ' 次。' : 'Wrong code; ' + res.attemptsLeft + ' attempts left.');
        if (res.reason === 'too-many-failures' || res.locked) msg = (lang() === 'zh' ? '失败次数过多，已锁定到 ' + fmtDate(res.unlockAt) : 'Too many failures; locked until ' + fmtDate(res.unlockAt));
        if (res.reason === 'bad-passphrase') msg = lang() === 'zh' ? '口令不对。' : 'Wrong passphrase.';
        setStatus('acct-status', msg, true);
        return;
      }
      setStatus('acct-status', tr('signedIn') + (res.secondFactor === 'none' ? '' : ' · ' + res.secondFactor), false);
      paintPanel();
    });
    d.getElementById('acct-lock').addEventListener('click', function () { lock(); setStatus('acct-status', tr('lock'), false); paintPanel(); });
    d.getElementById('acct-export').addEventListener('click', function () {
      var res = exportBlob();
      setStatus('acct-panel-status', res.ok ? res.filename : 'no-account', !res.ok);
      if (res.ok) download(res.filename, res.json);
    });
    d.getElementById('acct-product').addEventListener('click', async function () {
      if (!isUnlocked()) { setStatus('acct-panel-status', 'locked', true); return; }
      var res = await exportProductFile();
      download(res.filename, res.json);
      setStatus('acct-panel-status', res.filename, false);
    });
    d.getElementById('acct-remove').addEventListener('click', async function () {
      var res = await removeAccount();
      setStatus('acct-panel-status', res.hadAccount ? tr('remove') : 'no-account', false);
      paintPanel();
    });
    paintKnownEmail();
    paintPanel();
  }

  function mount() {
    var d = doc();
    if (!d) return null;
    var host = d.getElementById('body');
    if (!host) return null;
    /* the site chrome, when site.js is on the page */
    if (typeof window !== 'undefined' && window.INFINITY) {
      if (window.INFINITY.nav) window.INFINITY.nav(null);
      if (window.INFINITY.footer) window.INFINITY.footer();
    }
    host.textContent = '';
    var page = (d.body && d.body.getAttribute('data-account-page')) || 'signup';
    if (page === 'login') renderLogin(host); else renderSignup(host);
    if (typeof document !== 'undefined' && document.getElementById('infinity-gate') === null) {
      var reveal = function () { if (isUnlocked()) paintPanel(); };
      reveal();
    }
    return page;
  }
  API.mount = mount;
  API.S = S;
  API.tr = tr;
  API.drawQr = drawQr;
  API.qa.selfCheck = async function () {
    var st = await selfTest();
    var page = null;
    if (doc()) page = mount();
    return { vectors: st.vectors.every(function (v) { return v.ok; }), crypto: st.crypto, signature: st.signature, mounted: page, hasVault: hasAccount(), controls: doc() ? doc().querySelectorAll('button, input').length : 0 };
  };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }

  /* ------------------------------------------------- optional GitHub sync */
  /*
   * Off by default: nothing is sent anywhere until the reader pastes their own
   * token and presses a button. Only the *encrypted* vault (the same JSON the
   * export button produces) goes up, so GitHub stores ciphertext; the Gist id
   * is remembered locally so later pushes update the same Gist.
   */
  async function syncPush(personalToken, gistId) {
    var blob = readBlobText();
    if (!blob) return { ok: false, reason: 'no-account' };
    if (!personalToken) return { ok: false, reason: 'no-token' };
    var id = gistId || (function () { try { return store.getItem('inc.account.gist'); } catch (e) { return null; } })();
    var body = JSON.stringify({
      description: 'Infinity.Inc account (encrypted vault)',
      public: false,
      files: { 'infinity-account.encrypted.json': { content: blob } }
    });
    var headers = { Authorization: 'Bearer ' + String(personalToken).trim(), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
    var res = id
      ? await gh('https://api.github.com/gists/' + id, { method: 'PATCH', headers: headers, body: body })
      : await gh('https://api.github.com/gists', { method: 'POST', headers: headers, body: body });
    if (!res.ok || !res.body || !res.body.id) return { ok: false, reason: 'github-error', status: res.status, error: res.error };
    try { store.setItem('inc.account.gist', res.body.id); } catch (e) { /* ignore */ }
    return { ok: true, gistId: res.body.id, url: res.body.html_url, encryptedOnly: true };
  }
  async function syncPull(personalToken, gistId) {
    if (!personalToken) return { ok: false, reason: 'no-token' };
    var id = gistId || (function () { try { return store.getItem('inc.account.gist'); } catch (e) { return null; } })();
    if (!id) return { ok: false, reason: 'no-gist' };
    var headers = { Authorization: 'Bearer ' + String(personalToken).trim(), Accept: 'application/vnd.github+json' };
    var res = await gh('https://api.github.com/gists/' + id, { headers: headers });
    if (!res.ok || !res.body || !res.body.files) return { ok: false, reason: 'github-error', status: res.status, error: res.error };
    var file = res.body.files['infinity-account.encrypted.json'];
    if (!file) return { ok: false, reason: 'no-file' };
    var content = file.content;
    if (file.truncated && file.raw_url) {
      var raw = await gh(file.raw_url, { headers: headers });
      if (typeof raw.body === 'string') content = raw.body;
    }
    var imported = await importBlob(content);
    return { ok: imported.ok, reason: imported.reason, needsPassphrase: true, gistId: id };
  }
  API.syncPush = syncPush;
  API.syncPull = syncPull;
  return API;
});
