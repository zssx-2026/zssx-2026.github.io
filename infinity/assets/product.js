/*
 * Infinity.Inc - one product page, six routes.
 *
 * The six download pages differ only in which product they describe, so they
 * are one script and six small HTML files rather than six near-identical
 * pages. The slug is read from the page's own path, which keeps the file in
 * step with the route it is served at.
 *
 * The page lists what can be downloaded: assets/download.js reads the
 * product's own releases, switches platform and puts every version behind a
 * collapsed row. The card is kept as the fallback when that list cannot be
 * fetched.
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
      { route: '/download/', label: I.t('downloadTitle') },
      { label: product.name }
    ]);

    app.appendChild(I.el('h1', { text: product.name }));
    app.appendChild(I.el('p', { class: 'lede', text: I.tagline(product) }));

    var mount = I.el('div', { class: 'dl-mount' });
    app.appendChild(mount);
    mountDownload(mount, product);
  }

  /*
   * assets/download.css and assets/download.js are loaded from here rather
   * than from the twelve product pages, so the pages themselves stay small
   * and a change to the list does not mean touching every one of them.
   */
  function mountDownload(host, product) {
    if (!document.querySelector('link[data-dl]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = I.BASE + '/assets/download.css';
      link.setAttribute('data-dl', '');
      document.head.appendChild(link);
    }
    var start = function () {
      if (I.download) { I.download.render(host, product); return; }
      var grid = I.el('div', { class: 'grid' });
      grid.appendChild(I.productCard(product));
      host.appendChild(grid);
    };
    if (I.download) { start(); return; }
    var s = document.createElement('script');
    s.src = I.BASE + '/assets/download.js';
    s.onload = start;
    s.onerror = start;
    document.head.appendChild(s);
  }

  document.addEventListener('DOMContentLoaded', function () {
    I.nav(location.pathname.replace(/\/+$/, '') + '/');
    I.footer();
    I.applyTranslations();
    render(slugFromPath());
  });
})();
