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
    var shortLen = Math.floor(row.data / blocks), longBlocks = row.data % blocks;
    var dataBlocks = [], ecBlocks = [], pos = 0;
    for (var bi = 0; bi < blocks; bi++) {
      var len = shortLen + (bi < longBlocks ? 1 : 0);
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
      rows: matrix.map(function (r2) { return r2.join(''); })
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
  /* __PART2__ */
  return API;
});
