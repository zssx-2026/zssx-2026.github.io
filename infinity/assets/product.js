/*
 * Infinity.Inc - one product page, five routes.
 *
 * The five download pages differ only in which product they describe, so they
 * are one script and five small HTML files rather than five near-identical
 * pages. The slug is read from the page's own path, which keeps the file in
 * step with the route it is served at.
 *
 * What the page shows comes from GitHub at the moment it is opened. There is
 * no list of download links baked into the site, because a baked list is
 * wrong the first time a release is published and nobody notices.
 */

(function () {
  'use strict';

  var I = window.INFINITY;

  function slugFromPath() {
    var path = location.pathname.replace(/\/+$/, '');
    var parts = path.split('/');
    return parts[parts.length - 1] || '';
  }

  function render(slug) {
    var product = I.productBySlug(slug);
    var app = document.getElementById('app');

    if (!product) {
      app.appendChild(I.el('h1', { text: I.t('unknownProduct') }));
      app.appendChild(I.el('p', { class: 'lede', text: I.t('noProductNamed') + ' "' + slug + '".' }));
      app.appendChild(I.el('p', null, [I.link(I.page('/download/'), I.t('downloadTitle'))]));
      return;
    }

    document.title = product.name + ' — Infinity.Inc';

    I.crumbs(app, [
      { route: '/', label: 'Infinity.Inc' },
      { route: '/download/', label: 'Download' },
      { label: product.name }
    ]);

    app.appendChild(I.el('h1', { text: product.name }));
    app.appendChild(I.el('p', { class: 'lede', text: product.tagline }));

    var meta = I.el('p', { class: 'row small' });
    var host = I.el('div', { class: 'stack' });
    app.appendChild(meta);
    app.appendChild(host);

    I.loading(host, 'Reading releases…');

    Promise.all([I.releases(product.repo), I.repoInfo(product.repo)]).then(function (r) {
      var list = (r[0] || []).filter(function (x) { return !x.draft; });
      var info = r[1];

      I.clear(meta);
      meta.appendChild(I.el('span', { class: 'pill', text: 'exe ' + product.short }));
      meta.appendChild(I.el('span', { class: 'pill', text: 'windows' }));
      meta.appendChild(I.el('span', { class: 'pill', text: 'self-contained' }));
      meta.appendChild(I.link('https://github.com/zssx-2026/' + product.repo, I.t('source'), 'small'));

      I.clear(host);

      if (!list.length) {
        host.appendChild(I.el('div', { class: 'note warn', text:
          'No releases have been published for ' + product.name + ' yet. There is nothing to ' +
          'download, and this page will not offer a link that would not work.' }));
        return;
      }

      var settings = I.settings();
      var latest = list[0];

      // ---------------------------------------------------------- latest
      var card = I.el('div', { class: 'card' });
      var spread = I.el('div', { class: 'spread' });
      spread.appendChild(I.el('div', null, [
        I.el('h3', { text: I.t('latestFor') + ' ' + (latest.name || latest.tag_name || '') }),
        I.el('div', { class: 'small muted', text:
          'Published ' + I.fmtDate(latest.published_at) +
          (latest.prerelease ? ' · ' + I.t('preRelease') : '') })
      ]));
      card.appendChild(spread);

      var assets = I.assetsFor(latest, settings.downloadPlatform);
      var actions = I.el('div', { class: 'row', style: 'margin-top:14px' });

      if (!assets.length) {
        actions.appendChild(I.el('span', { class: 'muted small', text:
          I.t('noInstallerFor') + ' ' + settings.downloadPlatform + '.' }));
      } else {
        assets.slice(0, 4).forEach(function (asset) {
          actions.appendChild(I.el('a', {
            class: 'btn', href: asset.browser_download_url
          }, [asset.name, I.el('span', { class: 'small', text: I.fmtSize(asset.size) })]));
        });
      }
      card.appendChild(actions);

      var all = I.el('details', { style: 'margin-top:16px' });
      all.appendChild(I.el('summary', { class: 'small muted', text:
        I.t('allAssets') + ' (' + (latest.assets || []).length + ')' }));
      var table = I.el('table');
      table.appendChild(I.el('thead', null, [I.el('tr', null, [
        I.el('th', { text: I.t('product') }), I.el('th', { class: 'num', text: I.t('size') }),
        I.el('th', { text: I.t('digest') })
      ])]));
      var body = I.el('tbody');
      (latest.assets || []).forEach(function (asset) {
        var digest = asset.digest ? asset.digest.replace(/^sha256:/, '').slice(0, 16) + '…' : '';
        body.appendChild(I.el('tr', null, [
          I.el('td', null, [I.link(asset.browser_download_url, asset.name)]),
          I.el('td', { class: 'num', text: I.fmtSize(asset.size) }),
          I.el('td', { class: 'mono', text: digest || '—' })
        ]));
      });
      table.appendChild(body);
      all.appendChild(table);
      card.appendChild(all);
      host.appendChild(card);

      if (latest.body) {
        var notes = I.el('div', { class: 'card' });
        notes.appendChild(I.el('h3', { text: I.t('notes') }));
        var md = I.el('div', { class: 'md' });
        I.renderMarkdown(md, latest.body);
        notes.appendChild(md);
        host.appendChild(notes);
      }

      // ---------------------------------------------------------- history
      if (list.length > 1) {
        var hist = I.el('div', { class: 'card' });
        hist.appendChild(I.el('h3', { text: I.t('earlierReleases') }));
        var ht = I.el('table');
        ht.appendChild(I.el('thead', null, [I.el('tr', null, [
          I.el('th', { text: I.t('version') }), I.el('th', { text: I.t('published') }),
          I.el('th', { class: 'num', text: I.t('assets') }), I.el('th')
        ])]));
        var hb = I.el('tbody');
        list.slice(1, 11).forEach(function (rel) {
          hb.appendChild(I.el('tr', null, [
            I.el('td', { class: 'mono', text: rel.tag_name || '' }),
            I.el('td', { class: 'muted', text: I.fmtDate(rel.published_at) }),
            I.el('td', { class: 'num', text: I.fmtCount((rel.assets || []).length) }),
            I.el('td', null, [I.link(rel.html_url, I.t('releasesNotes'), 'small')])
          ]));
        });
        ht.appendChild(hb);
        hist.appendChild(ht);
        host.appendChild(hist);
      }
    }).catch(function (e) {
      I.failure(host, 'Could not read the releases: ' + e.message);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    I.nav(location.pathname.replace(/\/+$/, '') + '/');
    I.footer();
    I.applyTranslations();
    render(slugFromPath());
  });
})();
