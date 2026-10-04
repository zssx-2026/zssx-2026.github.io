/*
 * Infinity.Inc - the version list on a product's own download page.
 *
 * One collapsed row per version, a platform switch above it, and files
 * grouped by what they are: the exe installer, the Windows msi, the portable
 * zip, the source zip and the source zst.
 *
 * Only releases from the last year are listed; everything older is kept on
 * /infinity/versions/archive/, where each platform has one .zst holding all of
 * its files for that release, so an old version is still reachable without a
 * page that grows forever.
 *
 * Nothing is asked of the reader here: no digest to compare and no script to
 * run. A downloaded file unblocks itself when the application first starts.
 *
 * The list comes from assets/releases.json, written when the site is
 * published, so it needs no API quota, no proxy and no CORS; the live API is
 * the fallback for a release published after that file was built.
 */
(function () {
  'use strict';

  var I = window.INFINITY;
  var API = 'https://api.github.com/repos/zssx-2026/';
  var PLATFORM_KEY = 'inc.download.platform';
  var PRE_KEY = 'inc.download.pre';
  var SHOW_PRE = localStorage.getItem(PRE_KEY) !== '0';
  var YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  var PLATFORM_SHORT = {
    win16: 'Win16', win32: 'Win32', win64: 'Win64', winx86: 'WinX86', winarm: 'WinARM',
    linux16: 'Linux16', linux32: 'Linux32', linux64: 'Linux64', linuxx86: 'LinuxX86',
    mac16: 'Mac16', mac32: 'Mac32', mac64: 'Mac64', macx86: 'MacX86'
  };
  var PLATFORM_ORDER = ['win64', 'win32', 'win16', 'winx86', 'winarm',
    'linux64', 'linux32', 'linux16', 'linuxx86', 'mac64', 'mac32', 'mac16', 'macx86'];
  var ALIAS = {
    'win-x86': 'winx86', 'win-x64': 'win64', x64: 'win64', x86: 'winx86',
    'win-arm64': 'winarm', 'win-arm': 'winarm', arm64: 'winarm', arm: 'winarm',
    'linux-x86': 'linuxx86', 'linux-x64': 'linux64',
    'mac-x86': 'macx86', 'mac-x64': 'mac64', osx64: 'mac64', darwin64: 'mac64',
    amd64: 'win64', i386: 'winx86', i686: 'winx86'
  };
  var TOKEN = '(win16|win32|win64|winx86|win-x86|win-x64|x64|x86|win-arm64|win-arm|winarm|arm64|arm|amd64|i386|i686|linux16|linux32|linux64|linuxx86|linux-x86|linux-x64|linux-arm64|mac16|mac32|mac64|macx86|mac-x86|mac-x64|osx64|darwin64)';

  var TEXT = {
    en: {
      platform: 'Platform', loading: 'Loading versions…', showPre: 'Show pre-releases',
      noReleases: 'No release is published yet.', noAssets: 'No files for this platform in this version.',
      pre: 'pre-release', latest: 'latest', files: 'files', file: 'file', recent: 'Released in the last year',
      archive: 'Older releases are in the archive', archiveLink: 'Open the archive',
      kindSetup: 'Installer (exe)', kindMsi: 'Windows msi', kindPort: 'Portable (zip)',
      kindSrcZip: 'Source code (zip)', kindSrcZst: 'Source code (zst)', kindOther: 'Other files',
    },
    zh: {
      platform: '平台', loading: '正在加载版本…', showPre: '显示预发布版本',
      noReleases: '还没有发布任何版本。', noAssets: '该版本在此平台下没有文件。',
      pre: '预发布', latest: '最新', files: '个文件', file: '个文件', recent: '一年内发布的版本',
      archive: '更早的版本在归档里', archiveLink: '打开归档',
      kindSetup: 'exe 安装包', kindMsi: 'Windows msi', kindPort: '便携版 zip',
      kindSrcZip: '源代码 zip', kindSrcZst: '源代码 zst', kindOther: '其它文件',
    }
  };

  var ORDER = ['setup', 'msi', 'port', 'srczip', 'srczst', 'other'];
  var KIND_LABEL = { setup: 'kindSetup', msi: 'kindMsi', port: 'kindPort', srczip: 'kindSrcZip', srczst: 'kindSrcZst', other: 'kindOther' };

  function lang() {
    var l = (document.documentElement.getAttribute('lang') || 'en').toLowerCase();
    return l.indexOf('zh') === 0 ? 'zh' : 'en';
  }
  function t(k) { return TEXT[lang()][k] || k; }
  function el(tag, attrs, kids) { return I.el(tag, attrs, kids); }

  function bytes(n) {
    if (!n && n !== 0) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n = n / 1024; i++; }
    return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }
  function shortPlatform(code) { return PLATFORM_SHORT[code] || code; }
  function fold(token) {
    var k = String(token || '').toLowerCase();
    if (ALIAS[k]) return ALIAS[k];
    return PLATFORM_SHORT[k] ? k : null;
  }
  /* The last year only, counted from UTC now. */
  function isRecent(release) {
    var at = Date.parse(release.published_at || release.created_at || '');
    if (!at) return true;
    return (Date.now() - at) <= YEAR_MS;
  }
  function archiveHref() {
    if (I.page) return I.page('/versions/archive/');
    return String(I.BASE || '').replace(/\/assets.*$/, '') + '/versions/archive/';
  }

  function parseAsset(name) {
    if (/_hash\.txt$|\.hash(es)?$/i.test(name)) return null;
    var lower = name.toLowerCase();
    var base = name.replace(/\.(exe|msi|zip|7z|zst|tar\.gz|tar\.xz|dmg|deb|appimage)$/i, '');
    var versioned = new RegExp('^(.+?)_([0-9][^_]*)_' + TOKEN + '_([a-z0-9-]+)$', 'i').exec(base);
    var legacy = versioned ? null : new RegExp('^(.+?)_' + TOKEN + '(?:_([a-z0-9-]+))?$', 'i').exec(base);
    var m = versioned || legacy;
    if (!m) return null;
    var platform = fold(versioned ? m[3] : m[2]);
    if (!platform) return null;
    return {
      name: name, version: versioned ? m[2] : '', platform: platform,
      ext: (/\.([a-z0-9]+)$/i.exec(lower) || [, ''])[1],
      isSource: /(^|[_-])(source|sourcecode|src)([_-]|$)/.test(lower)
    };
  }

  /* The five categories the download page offers. */
  function categoryOf(parsed) {
    if (!parsed) return 'other';
    var ext = parsed.ext;
    if (ext === 'zst') return 'srczst';
    if (parsed.isSource) return ext === 'zip' ? 'srczip' : 'src' + ext;
    if (ext === 'exe') return 'setup';
    if (ext === 'msi') return 'msi';
    if (ext === 'zip') return 'port';
    return 'other';
  }

  function render(host, product) {
    var box = el('section', { class: 'dl' });
    host.appendChild(box);
    box.appendChild(el('p', { class: 'dl-state', text: t('loading') }));

    fetch(I.BASE + '/assets/releases.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('static HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var rels = data && data.repos && data.repos[product.repo];
        if (rels && rels.length) return rels;
        throw new Error('no static data for ' + product.repo);
      })
      .catch(function () {
        return fetch(API + product.repo + '/releases?per_page=30', { headers: { Accept: 'application/vnd.github+json' } })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      })
      .then(function (rels) { paint(box, product, rels); })
      .catch(function () {
        I.clear(box);
        box.appendChild(el('p', { class: 'dl-state', text: t('failed') }));
        var grid = el('div', { class: 'grid' });
        grid.appendChild(I.productCard(product));
        box.appendChild(grid);
      });
  }

  function platformsIn(releases) {
    var present = [];
    releases.forEach(function (r) {
      (r.assets || []).forEach(function (a) {
        var p = parseAsset(a.name);
        if (p && present.indexOf(p.platform) < 0) present.push(p.platform);
      });
    });
    present.sort(function (a, b) { return PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b); });
    return present;
  }

  function paint(box, product, releases) {
    I.clear(box);
    if (!releases || !releases.length) {
      box.appendChild(el('p', { class: 'dl-state', text: t('noReleases') }));
      return;
    }
    var recent = releases.filter(isRecent);
    var older = releases.filter(function (r) { return !isRecent(r); });
    if (!recent.length && releases.length) { recent = releases.slice(); older = []; }

    var present = platformsIn(recent);
    if (!present.length) present = platformsIn(releases);

    var chosen = localStorage.getItem(PLATFORM_KEY);
    if (!chosen || present.indexOf(chosen) < 0) chosen = present[0] || 'win64';

    var bar = el('div', { class: 'dl-bar' });
    var seg = el('div', { class: 'dl-seg', role: 'tablist', 'aria-label': t('platform') });
    present.forEach(function (p) {
      var b = el('button', { type: 'button', class: 'dl-seg-btn' + (p === chosen ? ' is-on' : ''), title: p, text: shortPlatform(p) });
      b.addEventListener('click', function () {
        localStorage.setItem(PLATFORM_KEY, p);
        chosen = p;
        Array.prototype.forEach.call(seg.children, function (c) { c.classList.toggle('is-on', c === b); });
        paintVersions(list, recent, chosen);
      });
      seg.appendChild(b);
    });
    bar.appendChild(seg);

    var preWrap = el('label', { class: 'dl-pre' });
    var pre = el('input', { type: 'checkbox' });
    pre.checked = SHOW_PRE;
    pre.addEventListener('change', function () {
      SHOW_PRE = pre.checked;
      localStorage.setItem(PRE_KEY, SHOW_PRE ? '1' : '0');
      paintVersions(list, recent, chosen);
    });
    preWrap.appendChild(pre);
    preWrap.appendChild(el('span', { text: t('showPre') }));
    bar.appendChild(preWrap);
    box.appendChild(bar);

    var list = el('div', { class: 'dl-list' });
    box.appendChild(list);
    paintVersions(list, recent, chosen);

    if (older.length) {
      var note = el('div', { class: 'dl-archive' });
      note.appendChild(el('span', { text: t('archive') + ' (' + older.length + ')' }));
      note.appendChild(el('a', { href: archiveHref(), text: t('archiveLink') + ' \u2192' }));
      box.appendChild(note);
    }
  }

  function paintVersions(host, releases, platform) {
    I.clear(host);
    var shown = releases.filter(function (r) { return SHOW_PRE || !r.prerelease; });
    if (!shown.length) shown = releases.slice(0, 1);

    shown.forEach(function (r, idx) {
      var assets = (r.assets || []).map(function (a) {
        var p = parseAsset(a.name);
        return p && p.platform === platform ? { raw: a, p: p, kind: categoryOf(p) } : null;
      }).filter(Boolean);

      var byKind = {};
      assets.forEach(function (x) { (byKind[x.kind] = byKind[x.kind] || []).push(x); });
      var total = assets.reduce(function (n, x) { return n + (x.raw.size || 0); }, 0);

      var d = el('details', { class: 'dl-ver' });
      if (assets.length && /(^|[?&])expand=1(&|$)/.test(location.search)) d.setAttribute('open', '');
      var sum = el('summary', { class: 'dl-sum' });
      sum.appendChild(el('span', { class: 'dl-ver-tag', text: r.tag_name || r.name }));
      if (r.prerelease) sum.appendChild(el('span', { class: 'pill dl-pill-pre', text: t('pre') }));
      if (idx === 0) sum.appendChild(el('span', { class: 'pill dl-pill-latest', text: t('latest') }));
      sum.appendChild(el('span', { class: 'dl-date', text: when(r.published_at) }));
      sum.appendChild(el('span', { class: 'dl-meta', text: assets.length + ' ' + (assets.length === 1 ? t('file') : t('files')) + ' \u00b7 ' + bytes(total) + ' \u00b7 ' + shortPlatform(platform) }));
      d.appendChild(sum);

      var body = el('div', { class: 'dl-body' });
      if (!assets.length) {
        body.appendChild(el('p', { class: 'dl-state', text: t('noAssets') }));
      } else {
        ORDER.forEach(function (kind) { if (byKind[kind]) body.appendChild(kindBlock(kind, byKind[kind])); });
        Object.keys(byKind).forEach(function (kind) {
          if (ORDER.indexOf(kind) < 0) body.appendChild(kindBlock(kind, byKind[kind]));
        });
      }
      d.appendChild(body);
      host.appendChild(d);
    });
  }

  function kindBlock(kind, items) {
    var sec = el('section', { class: 'dl-kind' });
    sec.appendChild(el('h4', { class: 'dl-kind-name', text: t(KIND_LABEL[kind] || 'kindOther') }));
    var ul = el('ul', { class: 'dl-files' });
    items.forEach(function (x) {
      var li = el('li', { class: 'dl-file' });
      li.appendChild(el('a', { class: 'dl-file-name', href: x.raw.browser_download_url, text: x.raw.name }));
      li.appendChild(el('span', { class: 'dl-file-size', text: bytes(x.raw.size) }));
      li.appendChild(el('span', { class: 'dl-file-date', text: when(x.raw.created_at) }));
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    return sec;
  }

  window.INFINITY = window.INFINITY || {};
  window.INFINITY.download = {
    render: render, parseAsset: parseAsset, categoryOf: categoryOf,
    shortPlatform: shortPlatform, fold: fold, isRecent: isRecent,
    platformsIn: platformsIn, archiveHref: archiveHref
  };
})();
