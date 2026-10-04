/*
 * Infinity.Inc - one product page, six routes.
 *
 * The six download pages differ only in which product they describe, so they
 * are one script and six small HTML files rather than six near-identical
 * pages. The slug is read from the page's own path, which keeps the file in
 * step with the route it is served at.
 *
 * The page is one card and the whole card is the link: it opens the product's
 * own repository, where the current release always lives. Nothing is listed
 * here, so there is no list to go stale.
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

    var grid = I.el('div', { class: 'grid' });
    grid.appendChild(I.productCard(product));
    app.appendChild(grid);
  }

  document.addEventListener('DOMContentLoaded', function () {
    I.nav(location.pathname.replace(/\/+$/, '') + '/');
    I.footer();
    I.applyTranslations();
    render(slugFromPath());
  });
})();
