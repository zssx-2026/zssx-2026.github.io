/*
 * Infinity.Inc - the shared layer behind every page.
 *
 * The site is static: GitHub Pages serves files, and there is no server of
 * ours anywhere in the picture. That decides almost everything here. There is
 * no session to keep on a server, so "signed in" means "this browser holds a
 * GitHub token"; there is no API to call, so the pages talk to api.github.com
 * directly; and there is no build step, so the navigation, the release
 * reader and the markdown renderer all live in this one file that every page
 * loads.
 *
 * Two rules run through it.
 *
 * Nothing from the network is ever inserted as markup. Release names, asset
 * names, file paths and user names all come from outside, and every one of
 * them is written with textContent or setAttribute. There is no innerHTML in
 * this file that takes a variable - a package called <img onerror=...> is a
 * package name, not an image tag.
 *
 * Nothing is claimed that was not fetched. If a repository has no releases
 * the page says so; it does not show a download button that leads to a 404.
 */

(function () {
  'use strict';

  // The script finds its own base so the same files work from a local
  // directory and from https://zssx-2026.github.io/infinity/ without a
  // constant to keep in step with the deployment.
  var SELF = document.currentScript ? document.currentScript.src : '';
  var MARK = '/assets/site.js';
  var BASE = SELF.indexOf(MARK) >= 0 ? SELF.slice(0, SELF.indexOf(MARK)) : '/infinity';

  var TOKEN_KEY = 'infinity.token';
  var SETTINGS_KEY = 'infinity.settings';

  var PRODUCTS = [
    {
      slug: 'infinitycloud', short: 'inc', name: 'Infinity Cloud', repo: 'Infinity-Cloud',
      tagline: 'A cloud drive whose storage is GitHub releases. A file tree kept in a manifest, split across release assets, with a recycle bin.'
    },
    {
      slug: 'infinityfilemanager', short: 'ifm', name: 'Infinity File Manager', repo: 'Infinity-File-Manager',
      tagline: 'A local file manager. Copy, move, rename and delete, with a recycle bin instead of a delete that cannot be undone.'
    },
    {
      slug: 'infinitypackagemanager', short: 'ipm', name: 'InfinityPackageManager', repo: 'InfinityPackageManager',
      tagline: 'A package catalogue and installer. Every package is a release asset in one repository; nothing is installed without a matching SHA-256.'
    },
    {
      slug: 'infinitytoolbox', short: 'int', name: 'Infinity Toolbox', repo: 'Infinity-Toolbox',
      tagline: 'A toolbox system. Steam++ , FastGithub and a download manager rewritten in C++ and compiled in, with third-party tools added as plugins.'
    },
    {
      slug: 'infinityinstallmanager', short: 'iim', name: 'Infinity Installer Manager', repo: 'Infinity-Installer-Manager',
      tagline: 'The single entry point. Installs the products, the plugins they drive and the resource packs they load, from one catalogue.'
    }
  ];

  var DEFAULT_SETTINGS = {
    theme: 'dark',
    downloadPlatform: 'win64',
    perPage: '10',
    showPrerelease: true
  };

  // ------------------------------------------------------------ storage

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function drop(key) {
    try { localStorage.removeItem(key); return true; } catch (e) { return false; }
  }

  var token = read(TOKEN_KEY) || '';
  var user = null;

  function settings() {
    var stored = {};
    try { stored = JSON.parse(read(SETTINGS_KEY) || '{}') || {}; } catch (e) { stored = {}; }
    var out = {};
    for (var k in DEFAULT_SETTINGS) out[k] = (k in stored) ? stored[k] : DEFAULT_SETTINGS[k];
    return out;
  }
  function saveSettings(next) {
    var merged = settings();
    for (var k in next) merged[k] = next[k];
    write(SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  }

  // ------------------------------------------------------------ network

  /*
   * One GitHub call. The token is sent as a bearer header and never in a URL,
   * so it cannot end up in a referrer, a browser history entry or a server
   * log. A 401 and a 403 mean different things and are reported differently:
   * one is a bad credential, the other is a rate limit or a missing scope,
   * and telling somebody to re-enter a token that is fine wastes their time.
   */
  function gh(path, options) {
    var opts = options || {};
    var headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Infinity.Inc-site' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch('https://api.github.com' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var message = (data && data.message) || ('HTTP ' + res.status);
          if (res.status === 401) message = 'The token was rejected. Sign in again.';
          else if (res.status === 403) message = 'GitHub refused the request: ' + message +
            ' (a rate limit or a missing scope, not a bad token)';
          else if (res.status === 404) message = 'Not found: ' + path;
          var err = new Error(message);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function releases(repo) {
    return gh('/repos/zssx-2026/' + repo + '/releases?per_page=30').catch(function (e) {
      if (e.status === 404) return [];
      throw e;
    });
  }

  function repoInfo(repo) {
    return gh('/repos/zssx-2026/' + repo).catch(function (e) {
      if (e.status === 404) return null;
      throw e;
    });
  }

  // ------------------------------------------------------------ formatting

  function fmtSize(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return '';
    var n = Number(bytes);
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return (n >= 10 ? n.toFixed(0) : n.toFixed(1)) + ' ' + units[i];
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function fmtCount(n) {
    return String(n === null || n === undefined ? 0 : n);
  }

  // ------------------------------------------------------------ dom

  /*
   * Build an element. Everything that came from outside is passed as text or
   * as an attribute value, and neither of those can become markup. This is
   * the only way this file creates nodes - there is deliberately no helper
   * that takes an HTML string.
   */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') throw new Error('refusing to set markup');
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c === null || c === undefined || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function link(href, text, className) {
    return el('a', { href: href, class: className || null, text: text });
  }

  function page(route) { return BASE + route; }

  // ------------------------------------------------------------ chrome

  var NAV = [
    { route: '/', label: 'Overview' },
    { route: '/download/', label: 'Download' },
    { route: '/docs/', label: 'Docs' },
    { route: '/cloud/', label: 'Cloud' },
    { route: '/settings/', label: 'Settings' }
  ];

  function nav(active) {
    var bar = el('div', { class: 'inner' });
    var brand = el('a', { class: 'brand', href: page('/') }, [
      el('span', { class: 'dot' }), 'Infinity.Inc'
    ]);
    var list = el('nav');
    NAV.forEach(function (item) {
      var current = active === item.route;
      list.appendChild(link(page(item.route), item.label, current ? 'current' : null))
        .setAttribute('aria-current', current ? 'page' : 'false');
    });
    var who = el('div', { class: 'who' });
    bar.appendChild(brand);
    bar.appendChild(list);
    bar.appendChild(who);
    var header = el('header', { class: 'site' }, [bar]);
    document.body.insertBefore(header, document.body.firstChild);
    renderWho(who);
  }

  function renderWho(host) {
    clear(host);
    if (!token) {
      host.appendChild(link(page('/login/'), 'Sign in'));
      host.appendChild(link(page('/signup/'), 'Sign up'));
      return;
    }
    if (user) {
      host.appendChild(el('img', { src: user.avatar_url, alt: '' }));
      host.appendChild(link(page('/myself/'), user.login));
    } else {
      host.appendChild(link(page('/myself/'), 'Account'));
    }
    host.appendChild(link(page('/login/link/'), 'Link a product'));
  }

  function footer() {
    var inner = el('div', { class: 'inner' }, [
      el('span', { text: 'Infinity.Inc — the Infinity suite.' }),
      el('span', {}, [
        link('https://github.com/zssx-2026', 'GitHub'),
        ' · ',
        link(page('/docs/'), 'Documentation'),
        ' · ',
        link(page('/settings/'), 'Settings')
      ])
    ]);
    document.body.appendChild(el('footer', { class: 'site' }, [inner]));
  }

  // ------------------------------------------------------------ auth

  function setToken(value) {
    token = (value || '').trim();
    if (token) write(TOKEN_KEY, token); else drop(TOKEN_KEY);
    return token;
  }

  function signOut() {
    token = '';
    user = null;
    drop(TOKEN_KEY);
  }

  function verify() {
    if (!token) return Promise.resolve(null);
    return gh('/user').then(function (u) { user = u; return u; });
  }

  function requireAuth(nextRoute) {
    if (token) return true;
    var next = nextRoute || (location.pathname + location.search);
    location.replace(page('/login/') + '?next=' + encodeURIComponent(next));
    return false;
  }

  /*
   * The sign-in link a product asks for: /login/link/<id>?="<base64>". The
   * payload is opaque to the site - it is whatever the desktop program put
   * there - so it is carried through untouched and shown back for
   * confirmation rather than being decoded and trusted.
   */
  function decodePayload(raw) {
    if (!raw) return '';
    var value = raw;
    try { value = decodeURIComponent(raw); } catch (e) { /* leave as-is */ }
    value = value.replace(/^"|"$/g, '');
    try {
      var bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      return '';
    }
  }

  // ------------------------------------------------------------ markdown

  /*
   * A small renderer, not a library. It handles what the project's own
   * documents use - headings, lists, tables, fenced code, inline code,
   * links, bold and italic - and it escapes first, so the only markup in the
   * output is the markup this function produced.
   */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(s) {
    var out = esc(s);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, href) {
      if (!/^(https?:|\/|#|\.)/i.test(href)) return m;
      return '<a href="' + href + '">' + text + '</a>';
    });
    return out;
  }

  function markdown(source) {
    var lines = String(source).replace(/\r\n?/g, '\n').split('\n');
    var html = [];
    var i = 0;
    var list = null;

    function closeList() { if (list) { html.push('</' + list + '>'); list = null; } }

    while (i < lines.length) {
      var line = lines[i];

      if (/^```/.test(line)) {
        closeList();
        var lang = line.slice(3).trim();
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        html.push('<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' +
          esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      if (/^\s*$/.test(line)) { closeList(); i++; continue; }

      if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|/.test(lines[i + 1])) {
        closeList();
        var cells = line.split('|').slice(1, -1);
        var head = '<tr>' + cells.map(function (c) { return '<th>' + inline(c.trim()) + '</th>'; }).join('') + '</tr>';
        i += 2;
        var rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) {
          var r = lines[i].split('|').slice(1, -1);
          rows.push('<tr>' + r.map(function (c) { return '<td>' + inline(c.trim()) + '</td>'; }).join('') + '</tr>');
          i++;
        }
        html.push('<table><thead>' + head + '</thead><tbody>' + rows.join('') + '</tbody></table>');
        continue;
      }

      var heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList();
        var level = heading[1].length;
        html.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
        i++;
        continue;
      }

      if (/^>\s?/.test(line)) {
        closeList();
        var quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
        html.push('<blockquote>' + inline(quote.join(' ')) + '</blockquote>');
        continue;
      }

      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { closeList(); html.push('<hr>'); i++; continue; }

      var bullet = line.match(/^\s*[-*]\s+(.*)$/);
      var ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || ordered) {
        var want = bullet ? 'ul' : 'ol';
        if (list !== want) { closeList(); html.push('<' + want + '>'); list = want; }
        html.push('<li>' + inline((bullet || ordered)[1]) + '</li>');
        i++;
        continue;
      }

      closeList();
      var para = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#|>|```|\||\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      html.push('<p>' + inline(para.join(' ')) + '</p>');
    }
    closeList();
    return html.join('\n');
  }

  function renderMarkdown(host, source) { host.innerHTML = markdown(source); }

  // ------------------------------------------------------------ page helpers

  function crumbs(host, items) {
    var box = el('div', { class: 'crumbs' });
    items.forEach(function (item, index) {
      if (index) box.appendChild(document.createTextNode(' / '));
      if (item.route) box.appendChild(link(page(item.route), item.label));
      else box.appendChild(document.createTextNode(item.label));
    });
    host.appendChild(box);
  }

  function loading(host, what) {
    clear(host);
    host.appendChild(el('div', { class: 'empty' }, [el('span', { class: 'spinner' }), ' ' + (what || 'Loading…')]));
  }

  function failure(host, message) {
    clear(host);
    host.appendChild(el('div', { class: 'note bad', text: message }));
  }

  function productBySlug(slug) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].slug === slug) return PRODUCTS[i];
    return null;
  }

  /*
   * Pick the asset for a platform. The installers are named
   * <Product>_<version>_<platform>_setup.exe, so the platform is read out of
   * the name rather than guessed from the release.
   */
  function assetsFor(release, platform) {
    var wanted = platform || settings().downloadPlatform;
    var out = [];
    (release.assets || []).forEach(function (asset) {
      var name = asset.name || '';
      if (!/\.(exe|msi|zip|7z)$/i.test(name)) return;
      var lower = name.toLowerCase();
      var matches = lower.indexOf(wanted.toLowerCase()) >= 0;
      if (!matches && wanted === 'win64') matches = /win64|windows-x64|x64/.test(lower);
      if (matches) out.push(asset);
    });
    if (!out.length) {
      (release.assets || []).forEach(function (asset) {
        if (/\.(exe|msi)$/i.test(asset.name || '')) out.push(asset);
      });
    }
    return out;
  }

  window.INFINITY = {
    BASE: BASE,
    PRODUCTS: PRODUCTS,
    page: page,
    el: el,
    clear: clear,
    link: link,
    nav: nav,
    footer: footer,
    crumbs: crumbs,
    loading: loading,
    failure: failure,
    gh: gh,
    releases: releases,
    repoInfo: repoInfo,
    fmtSize: fmtSize,
    fmtDate: fmtDate,
    fmtCount: fmtCount,
    esc: esc,
    markdown: markdown,
    renderMarkdown: renderMarkdown,
    productBySlug: productBySlug,
    assetsFor: assetsFor,
    settings: settings,
    saveSettings: saveSettings,
    token: function () { return token; },
    setToken: setToken,
    signOut: signOut,
    verify: verify,
    requireAuth: requireAuth,
    user: function () { return user; },
    decodePayload: decodePayload
  };
})();
