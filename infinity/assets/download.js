/*
 * Infinity.Inc - the version list on a product's own download page.
 *
 * The page used to be one card that linked away, which meant it never listed
 * what can actually be downloaded. This renders the product's own releases:
 * a platform switch at the top, then one collapsed row per version that
 * opens into its files grouped by kind (setup / port).
 *
 * The releases come from the GitHub API for the product's own repository, so
 * the list follows the repository instead of a copy kept in this file. When
 * the API is rate limited or offline the page falls back to the plain link,
 * which still works.
 */
(function () {
  'use strict';

  var I = window.INFINITY;
  var API = 'https://api.github.com/repos/zssx-2026/';
  var PLATFORM_KEY = 'inc.download.platform';
  var PRE_KEY = 'inc.download.pre';
  var SHOW_PRE = localStorage.getItem(PRE_KEY) !== '0';

  var TEXT = {
    en: {
      platform: 'Platform', versions: 'Versions', files: 'files', file: 'file',
      kindSetup: 'Installer', kindPort: 'Portable', other: 'Other files',
      showPre: 'Show pre-releases', openRelease: 'Open the release page',
      loading: 'Loading versions…', noAssets: 'No files for this platform in this version.',
      noReleases: 'No release is published yet.', failed: 'The version list is unavailable right now.',
      pre: 'pre-release', latest: 'latest', size: 'Size', published: 'Published',
      all: 'all platforms', noneForPlatform: 'This platform has no files in any published version.'
    },
    zh: {
      platform: '平台', versions: '版本', files: '个文件', file: '个文件',
      kindSetup: '安装包', kindPort: '便携版', other: '其它文件',
      showPre: '显示预发布版本', openRelease: '打开该版本的 Release 页',
      loading: '正在加载版本…', noAssets: '该版本在此平台下没有文件。',
      noReleases: '还没有发布任何版本。', failed: '暂时无法获取版本列表。',
      pre: '预发布', latest: '最新', size: '大小', published: '发布时间',
      all: '全部平台', noneForPlatform: '该平台在任何已发布版本里都没有文件。'
    }
  };

  function lang() {
    var l = (document.documentElement.getAttribute('lang') || 'en').toLowerCase();
    return l.indexOf('zh') === 0 ? 'zh' : 'en';
  }
  function t(k) { return TEXT[lang()][k] || k; }

  function bytes(n) {
    if (!n && n !== 0) return '';
    var u = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) { n = n / 1024; i++; }
    return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /*
   * Assets are named <Product>_<version>_<platform>_<kind>.<ext> now, and
   * <Product>_<platform>_<kind>.<ext> in the first releases. Both are read,
   * and the hash sidecars that sit next to an asset are not files to offer.
   */
  var PLATFORMS = /^(win64|win32|x86|x64|arm64|win-arm64|win-x64|win-x86)$/i;
  function normalisePlatform(p) { return p.toLowerCase().replace(/^win-/, ''); }

  function parseAsset(name) {
    if (/_hash\.txt$|\.hash(es)?$/i.test(name)) return null;
    var base = name.replace(/\.(exe|msi|zip|7z|tar\.gz|dmg|deb|appimage)$/i, '');
    var versioned = /^(.+?)_([0-9][^_]*)_(win64|win32|x86|x64|arm64|win-arm64|win-x64|win-x86)_([a-z0-9-]+)$/i.exec(base);
    if (versioned) {
      return { name: name, version: versioned[2], platform: normalisePlatform(versioned[3]), kind: versioned[4].toLowerCase() };
    }
    var legacy = /^(.+?)_(win64|win32|x86|x64|arm64|win-arm64|win-x64|win-x86)(?:_([a-z0-9-]+))?$/i.exec(base);
    if (legacy) {
      return { name: name, version: '', platform: normalisePlatform(legacy[2]), kind: (legacy[3] || 'other').toLowerCase() };
    }
    return null;
  }

  function el(tag, attrs, kids) { return I.el(tag, attrs, kids); }

  function render(host, product) {
    var box = el('section', { class: 'dl' });
    host.appendChild(box);
    box.appendChild(el('p', { class: 'dl-state', text: t('loading') }));

    fetch(API + product.repo + '/releases?per_page=30', { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (rels) { paint(box, product, rels); })
      .catch(function () {
        I.clear(box);
        box.appendChild(el('p', { class: 'dl-state', text: t('failed') }));
        var card = el('div', { class: 'grid' });
        card.appendChild(I.productCard(product));
        box.appendChild(card);
      });
  }

  function paint(box, product, releases) {
    I.clear(box);
    if (!releases || !releases.length) {
      box.appendChild(el('p', { class: 'dl-state', text: t('noReleases') }));
      return;
    }

    var platforms = [];
    releases.forEach(function (r) {
      (r.assets || []).forEach(function (a) {
        var p = parseAsset(a.name);
        if (p && platforms.indexOf(p.platform) < 0) platforms.push(p.platform);
      });
    });
    platforms.sort(function (a, b) { return a === 'win64' ? -1 : b === 'win64' ? 1 : a < b ? -1 : 1; });

    var chosen = localStorage.getItem(PLATFORM_KEY);
    if (!chosen || platforms.indexOf(chosen) < 0) chosen = platforms[0] || 'win64';

    var bar = el('div', { class: 'dl-bar' });
    var seg = el('div', { class: 'dl-seg', role: 'tablist', 'aria-label': t('platform') });
    platforms.forEach(function (p) {
      var b = el('button', { type: 'button', class: 'dl-seg-btn' + (p === chosen ? ' is-on' : ''), text: p });
      b.addEventListener('click', function () {
        localStorage.setItem(PLATFORM_KEY, p);
        chosen = p;
        Array.prototype.forEach.call(seg.children, function (c) { c.classList.toggle('is-on', c === b); });
        paintVersions(list, releases, chosen);
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
      paintVersions(list, releases, chosen);
    });
    preWrap.appendChild(pre);
    preWrap.appendChild(el('span', { text: t('showPre') }));
    bar.appendChild(preWrap);

    var releaseLink = el('a', { class: 'dl-openrel', href: I.productHref(product), text: t('openRelease') });
    bar.appendChild(releaseLink);
    box.appendChild(bar);

    var list = el('div', { class: 'dl-list' });
    box.appendChild(list);
    paintVersions(list, releases, chosen);
  }

  function paintVersions(host, releases, platform) {
    I.clear(host);
    var shown = releases.filter(function (r) { return SHOW_PRE || !r.prerelease; });
    if (!shown.length) shown = releases.slice(0, 1);

    shown.forEach(function (r, idx) {
      var assets = (r.assets || []).map(function (a) { return { raw: a, p: parseAsset(a.name) }; })
        .filter(function (x) { return x.p && x.p.platform === platform; });

      var byKind = {};
      assets.forEach(function (x) { (byKind[x.p.kind] = byKind[x.p.kind] || []).push(x); });
      var total = assets.reduce(function (n, x) { return n + (x.raw.size || 0); }, 0);

      var d = el('details', { class: 'dl-ver' });
      /* collapsed by default; ?expand=1 opens every version (used for tests) */
      if (assets.length && /(^|[?&])expand=1(&|$)/.test(location.search)) d.setAttribute('open', '');
      var sum = el('summary', { class: 'dl-sum' });
      sum.appendChild(el('span', { class: 'dl-ver-tag', text: r.tag_name || r.name }));
      if (r.prerelease) sum.appendChild(el('span', { class: 'pill dl-pill-pre', text: t('pre') }));
      if (idx === 0) sum.appendChild(el('span', { class: 'pill dl-pill-latest', text: t('latest') }));
      sum.appendChild(el('span', { class: 'dl-date', text: when(r.published_at) }));
      sum.appendChild(el('span', { class: 'dl-meta', text: assets.length + ' ' + (assets.length === 1 ? t('file') : t('files')) + ' · ' + bytes(total) + ' · ' + platform }));
      d.appendChild(sum);

      var body = el('div', { class: 'dl-body' });
      if (!assets.length) {
        body.appendChild(el('p', { class: 'dl-state', text: t('noAssets') }));
      } else {
        ['setup', 'port'].forEach(function (kind) {
          if (!byKind[kind]) return;
          body.appendChild(kindBlock(kind, byKind[kind]));
        });
        Object.keys(byKind).forEach(function (kind) {
          if (kind !== 'setup' && kind !== 'port') body.appendChild(kindBlock(kind, byKind[kind]));
        });
      }
      var rel = el('a', { class: 'dl-openrel', href: r.html_url, text: t('openRelease') });
      body.appendChild(rel);
      d.appendChild(body);
      host.appendChild(d);
    });
  }

  function kindBlock(kind, items) {
    var label = kind === 'setup' ? t('kindSetup') : kind === 'port' ? t('kindPort') : (t('other') + ' · ' + kind);
    var sec = el('section', { class: 'dl-kind' });
    sec.appendChild(el('h4', { class: 'dl-kind-name', text: label }));
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
  window.INFINITY.download = { render: render, parseAsset: parseAsset };
})();
