/*
 * Infinity.Inc - the token keys kept in this browser.
 *
 * There is no server behind this site, so a token cannot be issued, checked or
 * revoked anywhere but here: the vault lives in localStorage under
 * inc.tokens.v1 and leaves the machine only when its owner exports it. That is
 * a real limitation and the page says so instead of pretending otherwise.
 *
 * A key nobody knows how to send is a key nobody can use, so the page also
 * writes down the one thing a product API needs from it: an Authorization
 * header carrying the secret as a bearer token.
 *
 * Secrets are masked until asked for, never put into a URL, and only written
 * to localStorage. Regenerating replaces the secret in the vault, so anything
 * that reads the vault stops accepting the old one - anything the old secret
 * was already pasted into keeps working, which is true of every key that has
 * left its owner's hands.
 */
(function () {
  'use strict';

  var I = window.INFINITY;
  var KEY = 'inc.tokens.v1';
  var VERSION = 1;
  var PREFIX = 'inc_';
  var zh = I.lang() === 'zh';

  var S = zh ? {
    title: '令牌密钥',
    lede: '用令牌密钥接入套件的产品 API。本站没有服务器，所以密钥保存在这个浏览器里 —— 创建、显示、复制、重新生成与删除都在本地完成，不上传也不校验。',
    localNote: '密钥只写在 localStorage（键 inc.tokens.v1）。导出 JSON 是把它带到另一台机器的唯一方式；清除浏览器数据会连同密钥一起删除。',
    createTitle: '创建令牌密钥',
    label: '备注',
    labelPlaceholder: '例如：我的笔记本',
    labelRequired: '请先填一个备注，以后才认得出它。',
    scopes: '权限范围',
    scopeRead: '读取',
    scopeWrite: '写入',
    scopeDelete: '删除',
    create: '创建',
    created: '已创建：',
    createdHint: '密钥默认打码，点“显示”再复制。',
    vaultTitle: '本浏览器中的密钥',
    vaultEmpty: '还没有密钥。在上面创建一个，就能复制进产品里用了。',
    secret: '密钥',
    show: '显示',
    hide: '隐藏',
    copy: '复制',
    copied: '已复制到剪贴板。',
    copyFailed: '浏览器不允许自动复制，请手动选中复制。',
    rotate: '重新生成',
    rotated: '已重新生成：旧密钥立即失效，请重新复制。',
    remove: '删除',
    removeAsk: '删除这个密钥？正在使用它的产品会立刻失去访问权。',
    removed: '已删除。',
    metaCreated: '创建于',
    metaRotated: '重新生成于',
    metaLastUsed: '最近使用',
    never: '从未（本站无后端，无法统计真实调用）',
    idLabel: 'ID',
    integrationTitle: '如何接入',
    integrationLede: '把密钥放进 Authorization 头，以 Bearer 方式发送。下面示例里的 inc_… 换成你自己的密钥；主机与端口换成产品实际监听的地址。',
    curlExample: 'curl 示例',
    jsExample: 'JavaScript 示例',
    copyExample: '复制示例',
    storageTitle: '导出与导入',
    storageLede: '导出会把全部密钥写成 JSON 文件；导入按 ID 合并，已存在的 ID 不会被覆盖。',
    export: '导出 JSON',
    import: '导入 JSON',
    imported: '已导入：新增 {n} 个，跳过 {m} 个。',
    importFailed: '这个文件不是本站导出的密钥 JSON。',
    saveFailed: '这个浏览器不允许写 localStorage，密钥无法保存。',
    footerNote: '本页不需要登录：密钥是本浏览器里的东西，与 GitHub 账户无关。'
  } : {
    title: 'Token keys',
    lede: 'Token keys are how a program signs in to the suite\u2019s product APIs. This site has no server, so a key is created, shown, copied, rotated and deleted in this browser only \u2014 nothing is uploaded and nothing is checked here.',
    localNote: 'Keys are written to localStorage only (key inc.tokens.v1). Exporting the JSON is the one way to carry them to another machine; clearing browser data deletes them with everything else.',
    createTitle: 'Create a token key',
    label: 'Label',
    labelPlaceholder: 'for example: my laptop',
    labelRequired: 'Give it a label first, so it can be recognised later.',
    scopes: 'Scopes',
    scopeRead: 'read',
    scopeWrite: 'write',
    scopeDelete: 'delete',
    create: 'Create',
    created: 'Created: ',
    createdHint: 'The secret is masked by default; press Show, then Copy.',
    vaultTitle: 'Keys in this browser',
    vaultEmpty: 'No keys yet. Create one above and it is ready to paste into a product.',
    secret: 'Secret',
    show: 'Show',
    hide: 'Hide',
    copy: 'Copy',
    copied: 'Copied to the clipboard.',
    copyFailed: 'The browser would not copy for you \u2014 select the text and copy it by hand.',
    rotate: 'Regenerate',
    rotated: 'Regenerated: the old secret is no longer valid here. Copy the new one.',
    remove: 'Delete',
    removeAsk: 'Delete this key? Anything using it loses access immediately.',
    removed: 'Deleted.',
    metaCreated: 'created',
    metaRotated: 'rotated',
    metaLastUsed: 'last used',
    never: 'never (no server here, so calls cannot be counted)',
    idLabel: 'ID',
    integrationTitle: 'How to use it',
    integrationLede: 'Send the secret in an Authorization header as a bearer token. Replace inc_\u2026 below with your own key, and the host and port with the address the product actually listens on.',
    curlExample: 'curl',
    jsExample: 'JavaScript',
    copyExample: 'Copy example',
    storageTitle: 'Export and import',
    storageLede: 'Export writes every key to a JSON file. Import merges by ID, so an ID that is already here is left alone.',
    export: 'Export JSON',
    import: 'Import JSON',
    imported: 'Imported: {n} added, {m} skipped.',
    importFailed: 'That file is not a key export from this site.',
    saveFailed: 'This browser will not let the page write to localStorage, so keys cannot be saved.',
    footerNote: 'This page needs no sign-in: the keys belong to this browser, not to a GitHub account.'
  };

  function el(tag, attrs, children) { return I.el(tag, attrs, children); }
  function status(node, message, bad) {
    node.textContent = message || '';
    node.className = 'token-status' + (bad ? ' bad' : '');
  }

  // ------------------------------------------------------------- the vault
  function readVault() {
    var out = [];
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return out;
      var data = JSON.parse(raw);
      if (data && Object.prototype.toString.call(data.tokens) === '[object Array]') out = data.tokens;
    } catch (e) { out = []; }
    return out.filter(function (t) {
      return t && typeof t.secret === 'string' && t.secret.indexOf(PREFIX) === 0;
    });
  }

  function writeVault(list) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, tokens: list })); return true; }
    catch (e) { return false; }
  }

  function hex(bytes) {
    var buf = new Uint8Array(bytes);
    var c = window.crypto || window.msCrypto;
    c.getRandomValues(buf);
    var out = '';
    for (var i = 0; i < buf.length; i++) out += ('0' + buf[i].toString(16)).slice(-2);
    return out;
  }

  function newSecret() { return PREFIX + hex(16); }
  function newId() { return 'tok_' + hex(6); }
  function maskOf() { return PREFIX + '\u2022'.repeat(20); }

  var revealed = {};
  var listHost = null;
  var createStatus = null;
  var storageStatus = null;

  function scopesOf() {
    var out = [];
    var boxes = document.querySelectorAll('.token-check input');
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) out.push(boxes[i].getAttribute('data-scope'));
    return out.length ? out : ['read'];
  }

  function scopeLabel(s) {
    if (s === 'read') return S.scopeRead;
    if (s === 'write') return S.scopeWrite;
    if (s === 'delete') return S.scopeDelete;
    return s;
  }

  function copyText(text) {
    function done() { status(createStatus, S.copied, false); }
    function fallback() {
      try {
        var area = el('textarea', { style: 'position:fixed;left:-9999px' });
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
        done();
      } catch (e) { status(createStatus, S.copyFailed, true); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }

  // ------------------------------------------------------------ the screen
  function itemRow(token) {
    var card = el('div', { class: 'card token-item', 'data-id': token.id });
    var head = el('div', { class: 'token-head' });
    head.appendChild(el('b', { text: token.label }));
    head.appendChild(el('span', { class: 'faint small', text: S.idLabel + ' ' + token.id }));
    (token.scopes || []).forEach(function (s) {
      head.appendChild(el('span', { class: 'pill', text: scopeLabel(s) }));
    });
    card.appendChild(head);

    var secretRow = el('div', { class: 'row', style: 'margin-top:10px' });
    secretRow.appendChild(el('code', { class: 'token-secret', text: revealed[token.id] ? token.secret : maskOf() }));
    var show = el('button', { class: 'btn ghost small', type: 'button', text: revealed[token.id] ? S.hide : S.show });
    show.addEventListener('click', function () { revealed[token.id] = !revealed[token.id]; list(); });
    secretRow.appendChild(show);
    var copy = el('button', { class: 'btn ghost small', type: 'button', text: S.copy });
    copy.addEventListener('click', function () { copyText(token.secret); });
    secretRow.appendChild(copy);
    card.appendChild(secretRow);

    var meta = el('div', { class: 'token-meta' });
    meta.appendChild(document.createTextNode(S.metaCreated + ' ' + I.fmtDate(token.createdAt)));
    if (token.rotatedAt) meta.appendChild(document.createTextNode(' \u00b7 ' + S.metaRotated + ' ' + I.fmtDate(token.rotatedAt)));
    meta.appendChild(document.createTextNode(' \u00b7 ' + S.metaLastUsed + ' ' + S.never));
    meta.appendChild(el('br'));
    meta.appendChild(document.createTextNode(S.label + ': ' + token.label + ' \u00b7 ' + S.scopes + ': ' + (token.scopes || []).map(scopeLabel).join(', ')));
    card.appendChild(meta);

    var actions = el('div', { class: 'token-actions' });
    var rot = el('button', { class: 'btn ghost small', type: 'button', text: S.rotate });
    rot.addEventListener('click', function () {
      token.secret = newSecret();
      token.rotatedAt = new Date().toISOString();
      revealed[token.id] = true;
      if (!writeVault(readVault().map(function (t) { return t.id === token.id ? token : t; }))) status(createStatus, S.saveFailed, true);
      list();
      status(createStatus, S.rotated, false);
    });
    actions.appendChild(rot);
    var del = el('button', { class: 'btn ghost small', type: 'button', text: S.remove });
    del.addEventListener('click', function () {
      if (!window.confirm(S.removeAsk)) return;
      writeVault(readVault().filter(function (t) { return t.id !== token.id; }));
      delete revealed[token.id];
      list();
      status(createStatus, S.removed, false);
    });
    actions.appendChild(del);
    card.appendChild(actions);
    return card;
  }

  function list() {
    I.clear(listHost);
    var rows = readVault();
    if (!rows.length) { listHost.appendChild(el('p', { class: 'muted', text: S.vaultEmpty })); return; }
    rows.slice().reverse().forEach(function (t) { listHost.appendChild(itemRow(t)); });
  }

  function exampleTexts() {
    return {
      curl: 'curl -H "Authorization: Bearer inc_<32 hex>" \\\n     http://127.0.0.1:8787/v1/ping',
      js: 'const res = await fetch("http://127.0.0.1:8787/v1/ping", {\n  headers: { Authorization: "Bearer inc_<32 hex>" }\n});'
    };
  }

  function codeCard(title, code) {
    var wrap = el('div', { class: 'token-code' });
    wrap.appendChild(el('h4', { text: title }));
    wrap.appendChild(el('pre', { class: 'block' }, [el('code', { text: code })]));
    return wrap;
  }

  function createCard() {
    var card = el('div', { class: 'card' });
    card.appendChild(el('h3', { text: S.createTitle }));
    var label = el('label', { class: 'token-field' });
    label.appendChild(el('span', { text: S.label }));
    label.appendChild(el('input', {
      class: 'token-input', id: 'token-label', type: 'text',
      placeholder: S.labelPlaceholder, maxlength: '60', autocomplete: 'off'
    }));
    card.appendChild(label);
    var checks = el('div', { class: 'token-checks' });
    checks.appendChild(el('span', { class: 'muted small', text: S.scopes + ':' }));
    ['read', 'write', 'delete'].forEach(function (s, i) {
      var check = el('label', { class: 'token-check' });
      var box = el('input', { type: 'checkbox', 'data-scope': s });
      if (i === 0) box.checked = true;
      check.appendChild(box);
      check.appendChild(el('span', { text: scopeLabel(s) }));
      checks.appendChild(check);
    });
    card.appendChild(checks);
    var button = el('button', { class: 'btn', id: 'token-create', type: 'button', text: S.create });
    button.addEventListener('click', function () {
      var input = document.getElementById('token-label');
      var labelText = (input && input.value ? input.value : '').replace(/^\s+|\s+$/g, '');
      if (!labelText) { status(createStatus, S.labelRequired, true); return; }
      var rows = readVault();
      rows.push({
        id: newId(), label: labelText, secret: newSecret(),
        createdAt: new Date().toISOString(), rotatedAt: null, lastUsedAt: null,
        scopes: scopesOf()
      });
      if (!writeVault(rows)) { status(createStatus, S.saveFailed, true); return; }
      if (input) input.value = '';
      list();
      status(createStatus, S.created + labelText + '\u3002 ' + S.createdHint, false);
    });
    card.appendChild(button);
    createStatus = el('div', { class: 'token-status', 'aria-live': 'polite' });
    card.appendChild(createStatus);
    return card;
  }

  function storageCard() {
    var card = el('div', { class: 'card' });
    card.appendChild(el('h3', { text: S.storageTitle }));
    card.appendChild(el('p', { class: 'muted small', text: S.storageLede }));
    var row = el('div', { class: 'row' });
    var out = el('button', { class: 'btn ghost', id: 'token-export', type: 'button', text: S.export });
    out.addEventListener('click', function () {
      var data = JSON.stringify({ v: VERSION, exportedAt: new Date().toISOString(), tokens: readVault() }, null, 2);
      var url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      var a = el('a', { href: url, download: 'infinity-tokens.json' });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    });
    row.appendChild(out);
    var file = el('input', { type: 'file', accept: '.json,application/json', id: 'token-import-file', style: 'display:none' });
    var inLabel = el('label', { class: 'btn ghost', for: 'token-import-file', text: S.import });
    row.appendChild(inLabel);
    row.appendChild(file);
    file.addEventListener('change', function () {
      if (!file.files || !file.files.length) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data = null;
        try { data = JSON.parse(String(reader.result)); } catch (e) { data = null; }
        if (!data || Object.prototype.toString.call(data.tokens) !== '[object Array]') { status(storageStatus, S.importFailed, true); return; }
        var rows = readVault();
        var have = {};
        rows.forEach(function (t) { have[t.id] = true; });
        var added = 0, skipped = 0;
        data.tokens.forEach(function (t) {
          if (!t || typeof t.secret !== 'string' || t.secret.indexOf(PREFIX) !== 0 || (t.id && have[t.id])) { skipped++; return; }
          var rowOut = {
            id: t.id || newId(), label: String(t.label || 'imported'), secret: t.secret,
            createdAt: t.createdAt || new Date().toISOString(), rotatedAt: t.rotatedAt || null,
            lastUsedAt: t.lastUsedAt || null,
            scopes: (t.scopes && t.scopes.length) ? t.scopes.slice() : ['read']
          };
          rows.push(rowOut); have[rowOut.id] = true; added++;
        });
        writeVault(rows);
        list();
        status(storageStatus, S.imported.replace('{n}', String(added)).replace('{m}', String(skipped)), false);
      };
      reader.readAsText(file.files[0]);
    });
    card.appendChild(row);
    storageStatus = el('div', { class: 'token-status', 'aria-live': 'polite' });
    card.appendChild(storageStatus);
    return card;
  }

  function build(host) {
    I.clear(host);
    I.crumbs(host, [
      { route: '/', label: 'Infinity.Inc' },
      { route: '/myself/', label: zh ? '账户' : 'Account' },
      { label: S.title }
    ]);
    host.appendChild(el('h1', { text: S.title }));
    host.appendChild(el('p', { class: 'lede', text: S.lede }));
    host.appendChild(el('p', { class: 'note', text: S.localNote }));
    host.appendChild(createCard());

    var vault = el('div', { class: 'card' });
    vault.appendChild(el('h3', { text: S.vaultTitle }));
    listHost = el('div', { id: 'token-list' });
    vault.appendChild(listHost);
    host.appendChild(vault);

    var use = el('div', { class: 'card' });
    use.appendChild(el('h3', { text: S.integrationTitle }));
    use.appendChild(el('p', { class: 'muted small', text: S.integrationLede }));
    var texts = exampleTexts();
    var curl = codeCard(S.curlExample, texts.curl);
    use.appendChild(curl);
    use.appendChild(codeCard(S.jsExample, texts.js));
    var copyExample = el('button', { class: 'btn ghost small', type: 'button', text: S.copyExample });
    copyExample.addEventListener('click', function () { copyText(texts.curl); });
    use.appendChild(copyExample);
    host.appendChild(use);

    host.appendChild(storageCard());
    host.appendChild(el('p', { class: 'faint small', text: S.footerNote }));
    list();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.title = S.title + ' \u2014 Infinity.Inc';
    I.nav('/myself/');
    I.footer();
    build(document.getElementById('body'));
  });
})();
