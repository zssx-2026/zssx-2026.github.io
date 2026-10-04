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

  // The same base, as a path. Once the browser has resolved
  // document.currentScript.src, BASE is an absolute URL, so it can never be a
  // prefix of location.pathname - comparing the two is what made the English
  // "中文" switch point back at the page it was already on.
  var BASE_PATH = '/infinity';
  try {
    BASE_PATH = new URL(BASE, location.href).pathname.replace(/\/+$/, '') || '/infinity';
  } catch (e) { /* keep the fallback */ }

  /*
   * The release the download cards point at, in one place.
   *
   * The suite's C++ builds are published as pre-releases, and GitHub's
   * /releases/latest skips those: on the older application repositories it
   * resolves to the Node-era stable v1.0pre1, which is not what the cards
   * should hand anybody. The tag is therefore named explicitly.
   *
   * Keep in step with cpp/release/v1.0pre4/release-assets.json ("tag") - the
   * directory name carries the same version. Both language versions read it
   * from here, so there is nothing else to update when it moves.
   */
  var RELEASE_TAG = 'v1.0.0-pre4';

  var TOKEN_KEY = 'infinity.token';
  var SETTINGS_KEY = 'infinity.settings';

  var PRODUCTS = [
    {
      slug: 'infinitycloud', short: 'inc', name: 'Infinity Cloud', repo: 'Infinity-Cloud',
      tagline: 'A cloud drive whose storage is GitHub releases. A file tree kept in a manifest, split across release assets, with a recycle bin.',
      taglineZh: '把 GitHub release 当存储的云盘：文件树写在清单里，按分片存进 release 资产，并带回收站。'
    },
    {
      slug: 'infinityfilemanager', short: 'ifm', name: 'Infinity File Manager', repo: 'Infinity-File-Manager',
      tagline: 'A local file manager. Copy, move, rename and delete, with a recycle bin instead of a delete that cannot be undone.',
      taglineZh: '本地文件管理器：复制、移动、重命名、删除，用回收站替代无法撤销的删除。'
    },
    {
      slug: 'infinitypackagemanager', short: 'ipm', name: 'InfinityPackageManager', repo: 'InfinityPackageManager',
      tagline: 'A package catalogue and installer. Every package is a release asset in one repository; nothing is installed without a matching SHA-256.',
      taglineZh: '软件包目录与安装器：每个包都是同一仓库里的 release 资产，SHA-256 不匹配就不会安装。'
    },
    {
      slug: 'infinitytoolbox', short: 'int', name: 'Infinity Toolbox', repo: 'Infinity-Toolbox',
      tagline: 'A toolbox system. Steam++ , FastGithub and a download manager rewritten in C++ and compiled in, with third-party tools added as plugins.',
      taglineZh: '工具箱：Steam++、FastGithub 与下载管理器的 C++ 重写版，第三方工具以插件形式接入。'
    },
    {
      slug: 'infinityinstallmanager', short: 'iim', name: 'Infinity Installer Manager', repo: 'Infinity-Installer-Manager',
      tagline: 'The single entry point. Installs the products, the plugins they drive and the resource packs they load, from one catalogue.',
      taglineZh: '统一入口：从同一份目录安装产品、它们驱动的插件以及加载的资源包。'
    },
    {
      slug: 'infinitygames', short: 'ing', name: 'Infinity Games', repo: 'Infinity-Games',
      tagline: 'A games library: online games played inside the window and local games run from disk, in one catalogue.',
      taglineZh: '游戏库：窗口里玩的在线游戏与从磁盘启动的本地游戏，收在同一个目录中。'
    }
  ];

  /*
   * The two languages, in one table.
   *
   * The site is served in English at /infinity/ and in Chinese at /infinity/cn/.
   * Every string lives here rather than in the pages, because a copy of each
   * page carrying its own translated prose is a pair that drifts the first time
   * somebody edits one of them - which is how a site ends up saying two things.
   * The pages read their language from <html lang>, so no page needs to know
   * which directory it sits in.
   */
  var T = {
    en: {
      suiteTitle: 'The Infinity suite',
      suiteLede: 'Six Windows applications that need nothing but Windows. No runtime, no DLL to install beside them, no installer required to get them running — each product is a single executable of a few hundred kilobytes.',
      products: 'Products',
      latest: 'Latest releases',
      howItFits: 'How it fits together',
      whereToStart: 'Where to start',
      product: 'Product', version: 'Version', published: 'Published', assets: 'Assets',
      size: 'Size', noReleases: 'no releases', unavailable: 'unavailable', nothingYet: 'nothing published yet',
      releaseNotes: 'release notes',
      reading: 'Reading releases…',
      liveNote: 'Read live from GitHub. A product with no releases is shown as such rather than offered.',
      twoFaces: 'Two faces, one executable',
      twoFacesText: 'Every product has a command line (<code>&lt;p&gt;_cli.exe</code>) and a window (<code>&lt;p&gt;_gui.exe</code>). The window is Electron rendering a page served by the same executable, so the executable is still the whole program. The terminal interface was removed: it duplicated the window without being better at anything.',
      oneCatalogue: 'One catalogue',
      oneCatalogueText: 'Products, plugins and resource packs all come from one index — a GitHub repository where each release is a catalogue page. Infinity Installer Manager is the single entry point that reads it.',
      unverified: 'Nothing runs unverified',
      unverifiedText: 'A package is only installed if the SHA-256 of the bytes on disk matches the digest GitHub reports for that asset. A build with no digest is refused rather than trusted.',
      wantEverything: 'If you want everything',
      wantEverythingText: 'Install <a href="./download/infinityinstallmanager/">Infinity Installer Manager</a>. It is the single entry point: one catalogue covering the products, the plugins they drive and the resource packs they load.',
      wantOne: 'If you want one thing',
      wantOneText: 'Every product installs on its own. Pick it from <a href="./download/">the download page</a> and ignore the rest.',
      wantRead: 'If you want to read first',
      wantReadText: 'The <a href="./docs/">documentation</a> is the project’s own files, rendered as they are — what is written there is what the code says.',
      downloadTitle: 'Download',
      downloadLede: 'Six applications. Pick one — the card opens its latest release on GitHub.',
      platform: 'Platform', requirements: 'Requirements',
      requirementsText: 'Windows 10 or later. That is the whole list. The executables import only DLLs that ship with Windows — <code>kernel32</code>, <code>user32</code>, <code>gdi32</code>, <code>winhttp</code> and the UCRT forwarders — so there is no runtime to install, no framework to download and nothing to keep updated beside the program itself.',
      requirementsNote: 'You will need a GitHub account and a personal access token: the suite stores its data in GitHub releases. See <a href="../docs/">the documentation</a> for how to create one.',
      downloadAction: 'Download',
      noBuild: 'no build for',
      contents: 'Contents',
      unknownProduct: 'Unknown product',
      noProductNamed: 'There is no product called',
      latestFor: 'Latest —',
      allAssets: 'All assets in this release',
      notesTitle: 'Release notes',
      earlier: 'Earlier releases',
      noManifest: 'This repository has no readable manifest.',
      emptyDrive: 'The drive is empty.',
      entries: 'entries',
      recycleBin: 'Recycle bin',
      restoreNote: 'Restoring and purging are done from the desktop program, which can rewrite the manifest. This page is read-only by design.',
      noStorage: 'No storage repository was found in this account.',
      storage: 'Storage',
      signIn: 'Sign in', signUp: 'Sign up', token: 'GitHub personal access token',
      account: 'Account', settings: 'Settings', cloud: 'Cloud', docs: 'Documentation',
      overview: 'Overview', profile: 'Account', linkProduct: 'Link a product'
    },
    zh: {
      suiteTitle: 'Infinity 套件',
      suiteLede: '六款只需要 Windows 的 Windows 应用。没有运行时，没有要一并安装的 DLL，也不需要安装程序才能跑起来 —— 每个产品都是一个几百 KB 的可执行文件。',
      products: '产品',
      latest: '最新发布',
      howItFits: '它们是怎么配合的',
      whereToStart: '从哪里开始',
      product: '产品', version: '版本', published: '发布时间', assets: '资产',
      size: '大小', noReleases: '暂无发布', unavailable: '无法获取', nothingYet: '尚未发布',
      releaseNotes: '发布说明',
      reading: '正在读取发布…',
      liveNote: '实时读取自 GitHub。没有发布的产品会如实显示，而不是给一个点不开的链接。',
      twoFaces: '两种形态，一个可执行文件',
      twoFacesText: '每个产品都有命令行（<code>&lt;p&gt;_cli.exe</code>）和窗口（<code>&lt;p&gt;_gui.exe</code>）。窗口是 Electron 渲染同一个可执行文件提供的页面，所以那个可执行文件仍然是整个程序。终端界面已移除：它只是把窗口重做了一遍，并没有更好。',
      oneCatalogue: '一份目录',
      oneCatalogueText: '产品、插件和资源包都来自同一份索引 —— 一个 GitHub 仓库，其中每个 release 就是一个目录页。Infinity Installer Manager 是读取它的统一入口。',
      unverified: '未校验的东西不会运行',
      unverifiedText: '只有在磁盘上算出的 SHA-256 与 GitHub 报告的摘要一致时，包才会被安装。没有摘要的构建会被拒绝，而不是被信任。',
      wantEverything: '如果你全都想要',
      wantEverythingText: '安装 <a href="./download/infinityinstallmanager/">Infinity Installer Manager</a>。它是统一入口：一份目录覆盖产品、产品所驱动的插件以及资源包。',
      wantOne: '如果你只要一个',
      wantOneText: '每个产品都能单独安装。从<a href="./download/">下载页</a>挑一个，其余的不用管。',
      wantRead: '如果你想先读一读',
      wantReadText: '<a href="./docs/">文档</a>是项目自己的文件，原样渲染 —— 写在那里的就是代码里说的。',
      downloadTitle: '下载',
      downloadLede: '六款应用。选一个 —— 卡片会打开它在 GitHub 上的最新发布。',
      platform: '平台', requirements: '系统要求',
      requirementsText: 'Windows 10 或更高版本。这就是全部要求。这些可执行文件只导入 Windows 自带的 DLL —— <code>kernel32</code>、<code>user32</code>、<code>gdi32</code>、<code>winhttp</code> 以及 UCRT 转发器 —— 所以没有运行时要安装，没有框架要下载，除了程序本身也没有别的东西需要保持更新。',
      requirementsNote: '你需要一个 GitHub 账号和个人访问令牌：这套软件把数据存在 GitHub release 里。如何创建，见<a href="../docs/">文档</a>。',
      downloadAction: '下载',
      noBuild: '没有适用于',
      contents: '目录',
      unknownProduct: '未知产品',
      noProductNamed: '没有名为',
      latestFor: '最新 ——',
      allAssets: '本版本的全部资产',
      notesTitle: '发布说明',
      earlier: '更早的发布',
      noManifest: '该仓库没有可读的清单。',
      emptyDrive: '云盘是空的。',
      entries: '项',
      recycleBin: '回收站',
      restoreNote: '还原与彻底删除由桌面程序完成，它能重写清单。本页按设计为只读。',
      noStorage: '该账户下没有找到存储仓库。',
      storage: '存储',
      signIn: '登录', signUp: '注册', token: 'GitHub 个人访问令牌',
      account: '账户', settings: '设置', cloud: '云盘', docs: '文档',
      overview: '概览', profile: '账户', linkProduct: '关联产品'
    }
  };

  Object.assign(T.en, {
    docsTitle: 'Documentation',
    docsLede: 'Read straight out of the project’s own files, so what is written here is what the code says.',
    sourceAt: 'Source:',
    notReadable: 'This document could not be read:',
    publishedIn: 'It is published in the source repository:',
    notPushedNote: 'A 404 here usually means the document has not been pushed yet rather than that it is missing from the project.',
    loginTitle: 'Sign in',
    loginLede: 'This site has no accounts of its own. Signing in means handing it a GitHub personal access token, which it keeps in this browser and uses to read the repositories the suite stores its data in.',
    tokenHint: 'Kept in this browser’s local storage. It is sent only to api.github.com, never to this site — there is no server here to send it to.',
    doSignIn: 'Sign in',
    createToken: 'Create a token',
    tokenNeeds: 'What the token needs',
    tokenNeedsText: 'A classic token with the <code>repo</code> scope, or a fine-grained token with read and write access to <em>Contents</em> for the repositories you want the suite to use. Read access alone is enough to browse; uploading needs write.',
    tokenWarning: 'The token is a password. Treat it like one — the <a href="./link/">link a product</a> page explains how to hand it to a desktop program without pasting it into a chat window.',
    checking: ' Checking the token…',
    pasteFirst: 'Paste a token first.',
    rejected: 'GitHub rejected that token. Check it was copied whole and has not expired.',
    cloudTitle: 'Cloud',
    cloudLede: 'The same drive Infinity Cloud shows on the desktop, read out of the same releases. A storage repository holds a manifest named <code>file.json</code>; the manifest names the files, and each file’s parts name the release assets that hold its bytes.',
    storageLabel: 'Storage',
    refresh: 'Refresh',
    driveEmpty: 'The drive is empty.',
    deleteColumn: 'Deleted',
    pathColumn: 'Path',
    typeColumn: 'Type',
    modifiedColumn: 'Modified',
    noParts: 'no parts',
    myselfTitle: 'Account',
    myselfLede: 'There is no Infinity account to manage. This page shows the GitHub account the suite is acting as, and what it can reach.',
    repositories: 'Repositories',
    storageRepos: 'Storage repositories',
    tokenInUse: 'Token in use',
    memberSince: 'Member since',
    yesBrowser: 'yes, in this browser only',
    signOutTitle: 'Sign out',
    signOutText: 'Signing out removes the token from this browser. It does not revoke it — revoke it on GitHub if you think it has been seen by somebody else.',
    settingsTitle: 'Settings',
    settingsLede: 'These are the preferences of this website in this browser. The desktop programs keep their own, and they are not shared — there is no account for them to be stored against.',
    downloadsSection: 'Downloads',
    platformFirst: 'Platform to offer first',
    showPre: 'Show pre-releases',
    appearance: 'Appearance',
    themeLabel: 'Theme',
    credential: 'Credential',
    savedRequests: 'Saved requests',
    resetTitle: 'Reset',
    noTokenBrowser: 'No token in this browser.',
    runTitle: 'Run a program',
    runLede: 'A desktop program opened this page with a request. A web page cannot start a program on your machine, so this page does the two things it actually can: it shows you exactly what is being asked for, and it hands the request to a copy of the suite you already have.',
    linkTitle: 'Link a product',
    linkLede: 'A desktop program opens this page to hand over a request: it puts a small payload in the address, this page shows it back, and once you are signed in it passes you to the matching run page.'
  });

  Object.assign(T.zh, {
    docsTitle: '文档',
    docsLede: '直接从项目自己的文件读取，所以这里写的就是代码里说的。',
    sourceAt: '来源：',
    notReadable: '该文档无法读取：',
    publishedIn: '它发布在源码仓库中：',
    notPushedNote: '这里的 404 通常表示文档还没推送，而不是项目里没有它。',
    loginTitle: '登录',
    loginLede: '本站点没有自己的账户。登录就是把一个 GitHub 个人访问令牌交给它，它把这个令牌保存在这个浏览器里，用来读取套件存放数据的那些仓库。',
    tokenHint: '保存在本浏览器的本地存储中。它只会发给 api.github.com，绝不会发给本站 —— 这里没有服务器可以接收它。',
    doSignIn: '登录',
    createToken: '创建令牌',
    tokenNeeds: '令牌需要什么权限',
    tokenNeedsText: '经典令牌需要 <code>repo</code> 作用域；细粒度令牌需要对要使用的仓库拥有 <em>Contents</em> 的读写权限。只读足以浏览，上传需要写权限。',
    tokenWarning: '令牌就是密码。请当密码对待 —— <a href="./link/">关联产品</a>页说明如何把它交给桌面程序，而不必贴进聊天窗口。',
    checking: ' 正在校验令牌…',
    pasteFirst: '请先粘贴令牌。',
    rejected: 'GitHub 拒绝了该令牌。请检查是否完整复制，以及是否过期。',
    cloudTitle: '云盘',
    cloudLede: '与桌面端 Infinity Cloud 相同的云盘，从相同的 release 读取。存储仓库里有一份名为 <code>file.json</code> 的清单；清单列出文件，而每个文件的分片指向保存其字节的 release 资产。',
    storageLabel: '存储',
    refresh: '刷新',
    driveEmpty: '云盘是空的。',
    deleteColumn: '删除时间',
    pathColumn: '路径',
    typeColumn: '类型',
    modifiedColumn: '修改时间',
    noParts: '无分片',
    myselfTitle: '账户',
    myselfLede: '没有什么“Infinity 账户”需要管理。本页显示套件正在以其身份行事的那个 GitHub 账户，以及它能访问的范围。',
    repositories: '仓库',
    storageRepos: '存储仓库',
    tokenInUse: '正在使用的令牌',
    memberSince: '注册于',
    yesBrowser: '是，仅在本浏览器',
    signOutTitle: '退出登录',
    signOutText: '退出会从这个浏览器移除令牌，但不会吊销它 —— 如果你认为令牌被别人看到过，请到 GitHub 上吊销。',
    settingsTitle: '设置',
    settingsLede: '这些是本网站在这个浏览器里的偏好。桌面程序有自己的一套，两者并不共享 —— 没有账户可以用来存放它们。',
    downloadsSection: '下载',
    platformFirst: '优先提供的平台',
    showPre: '显示预发布版本',
    appearance: '外观',
    themeLabel: '主题',
    credential: '凭据',
    savedRequests: '已保存的请求',
    resetTitle: '重置',
    noTokenBrowser: '本浏览器中没有令牌。',
    runTitle: '运行程序',
    runLede: '一个桌面程序带着请求打开了本页。网页无法启动你机器上的程序，所以本页只做它真正能做的两件事：把请求内容如实显示出来，并把请求交给你已经安装的那份套件。',
    linkTitle: '关联产品',
    linkLede: '桌面程序打开本页来递交一个请求：它把一小段载荷放进地址里，本页把它显示回来，一旦你登录就转到对应的运行页。'
  });

  // The product pages: the strings shared by all six of them, including the
  // names cn-mirror needs.
  Object.assign(T.en, {
    latestFor: 'Latest —',
    allAssets: 'All assets in this release',
    releasesNotes: 'release notes',
    notes: 'Release notes',
    earlierReleases: 'Earlier releases',
    noInstallerFor: 'no installer for',
    noBuildFor: 'no build for',
    noAssets: 'This release has no assets.',
    preRelease: 'pre-release',
    source: 'source',
    kind: 'Kind',
    digest: 'Digest',
    winX64: 'Windows x64',
    selfContained: 'self-contained'
  });

  Object.assign(T.zh, {
    latestFor: '最新 ——',
    allAssets: '本版本的全部资产',
    releasesNotes: '发布说明',
    notes: '发布说明',
    earlierReleases: '更早的发布',
    noInstallerFor: '没有适用于',
    noBuildFor: '没有适用于',
    noAssets: '本版本没有资产。',
    preRelease: '预发布',
    source: '源码',
    kind: '类型',
    digest: '摘要',
    winX64: 'Windows x64',
    selfContained: '自包含，无运行时'
  });

  // The language comes from <html lang>, so a page does not have to know
  // whether it is the English copy or the Chinese one.
  function lang() {
    var declared = (document.documentElement && document.documentElement.lang) ? document.documentElement.lang : '';
    if (declared && declared.toLowerCase().indexOf('zh') === 0) return 'zh';
    return 'en';
  }

  /*
   * Translate. An unknown key returns the key itself rather than an empty
   * string - a missing translation that shows up as "downloadsTitle" on the
   * page is obvious, whereas one that shows up as nothing is invisible.
   */
  function t(key) {
    var table = T[lang()] || T.en;
    if (key in table) return table[key];
    return (key in T.en) ? T.en[key] : key;
  }

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

  /*
   * One link helper, and it decides where the link opens.
   *
   * Anything that is not this site opens in a new tab, because following a link
   * to github.com and losing the page you were reading is worse than an extra
   * tab. `rel="noopener"` goes with every one of them: without it the page that
   * opens gets a handle back on this one.
   */
  function isExternal(href) {
    if (!href) return false;
    if (href.charAt(0) === '#' || href.charAt(0) === '.') return false;
    if (href.indexOf(BASE + '/') === 0 || href.indexOf(BASE) === 0) return false;
    return /^https?:/i.test(href);
  }

  function link(href, text, className) {
    var node = el('a', { href: href, class: className || null, text: text });
    if (isExternal(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener');
    }
    return node;
  }

  /*
   * A route inside the site, in whichever language this page is in.
   *
   * The Chinese copy lives at /infinity/cn/ and is otherwise identical, so
   * every link has to come back to the language the reader is already in -
   * nav, breadcrumbs, the sign-in redirect and the product pages all go
   * through here. A page therefore never needs to know which directory it
   * sits in.
   */
  function page(route) {
    return (inChinese() ? BASE + '/cn' : BASE) + route;
  }

  // ------------------------------------------------------------ chrome

  var NAV = [
    { route: '/', key: 'overview' },
    { route: '/download/', key: 'downloadTitle' },
    { route: '/docs/', key: 'docs' },
    { route: '/cloud/', key: 'cloud' },
    { route: '/settings/', key: 'settings' }
  ];

  /*
   * The other language is the same route with /cn/ added or removed. Working
   * it out from the path means a new page needs no entry anywhere: it is
   * bilingual as soon as both copies exist.
   */
  function inChinese() { return location.pathname.indexOf('/cn/') >= 0; }

  function otherLanguageHref() {
    var path = location.pathname;
    var suffix = location.search || '';
    if (inChinese()) return path.replace('/cn/', '/') + suffix;
    // Insert /cn/ right after the site base: /infinity/download/ becomes
    // /infinity/cn/download/, and so on for every route.
    if (path.indexOf(BASE_PATH) === 0) {
      var rest = path.slice(BASE_PATH.length);
      return BASE_PATH + '/cn' + (rest === '' || rest === '/' ? '/' : rest) + suffix;
    }
    // The Pages root page is outside the suite's directory and has no Chinese
    // copy of its own; its switch goes to the Chinese suite.
    return BASE_PATH + '/cn/' + suffix;
  }

  function labelForOtherLanguage() { return lang() === 'zh' ? 'English' : '中文'; }

  function nav(active) {
    var bar = el('div', { class: 'inner' });
    var brand = el('a', { class: 'brand', href: page('/') }, [
      el('span', { class: 'dot' }), 'Infinity.Inc'
    ]);
    var list = el('nav');
    NAV.forEach(function (item) {
      var current = active === item.route;
      list.appendChild(link(page(item.route), t(item.key), current ? 'current' : null))
        .setAttribute('aria-current', current ? 'page' : 'false');
    });
    var who = el('div', { class: 'who' });
    bar.appendChild(brand);
    bar.appendChild(list);
    // The other language, one click. The Chinese copy lives under /cn/ and
    // everything else is identical, so the switch is a path rewrite: take the
    // current route and move it in or out of /cn/.
    var other = el('a', { class: 'lang', href: otherLanguageHref(), title: labelForOtherLanguage() },
      [labelForOtherLanguage()]);
    bar.appendChild(other);
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

  /*
   * Fill in every element carrying data-t="key".
   *
   * This is the one place markup is written from a string. It is allowed
   * because the strings come from the table above, which is part of this site -
   * not from GitHub, not from a package name, not from anything a user typed.
   * Anything that did come from outside is still written with textContent.
   */
  function applyTranslations() {
    var nodes = document.querySelectorAll('[data-t]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var key = node.getAttribute('data-t');
      if (key) node.innerHTML = t(key);
    }
  }

  // ------------------------------------------------------------ product cards

  /*
   * One product, one card, and the whole card is the link. It points at the
   * product's own repository rather than at a file kept here, because the
   * release that is current today is not the one that will be current
   * tomorrow, and a link baked into this page would be wrong the first time
   * that changes.
   */
  function productHref(p) {
    /*
     * On the download index the card opens the product's own download page,
     * which lists every version and platform. Anywhere else it opens the
     * release itself, the one link that cannot go stale.
     */
    var here = location.pathname.replace(/\/+$/, '');
    if (/(^|\/)download$/.test(here) || /(^|\/)download\/index\.html$/.test(here)) {
      return page('/download/' + p.slug + '/');
    }
    return 'https://github.com/zssx-2026/' + p.repo + '/releases/tag/' + RELEASE_TAG;
  }

  function tagline(p) {
    return (lang() === 'zh' && p.taglineZh) ? p.taglineZh : p.tagline;
  }

  function productCard(p) {
    var card = el('a', { class: 'product pcard', href: productHref(p), title: p.name });
    card.appendChild(el('img', {
      class: 'icon', src: BASE + '/assets/icons/' + p.short + '.svg',
      alt: '', width: '48', height: '48', loading: 'lazy'
    }));
    card.appendChild(el('div', { class: 'tag', text: p.short }));
    card.appendChild(el('h3', { text: p.name }));
    card.appendChild(el('p', { class: 'tagline', text: tagline(p) }));
    card.appendChild(el('div', { class: 'row platforms' }, [
      el('span', { class: 'pill', text: t('winX64') }),
      el('span', { class: 'pill', text: t('selfContained') })
    ]));
    return card;
  }

  function cards(host) {
    clear(host);
    PRODUCTS.forEach(function (p) { host.appendChild(productCard(p)); });
  }

  window.INFINITY = {
    BASE: BASE,
    BASE_PATH: BASE_PATH,
    RELEASE_TAG: RELEASE_TAG,
    PRODUCTS: PRODUCTS,
    productHref: productHref,
    productCard: productCard,
    cards: cards,
    tagline: tagline,
    applyTranslations: applyTranslations,
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
    t: t,
    lang: lang,
    inChinese: inChinese,
    otherLanguageHref: otherLanguageHref,
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
