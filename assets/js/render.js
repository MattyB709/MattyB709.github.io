// Rendering of Markdown, frontmatter, lists, and math

// Expect Marked + DOMPurify + KaTeX auto-render to be loaded via CDN in the HTML.

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return await res.text();
}

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return await res.json();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseFrontmatter(text) {
  // Simple frontmatter parser: starts with --- and ends with ---
  if (!text.startsWith('---')) return { meta: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: text };
  const raw = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\s*\n/, '');
  const meta = {};
  raw.split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) {
      const key = m[1].trim();
      let val = m[2].trim();
      // remove surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
  });
  return { meta, body };
}

function toYouTubeEmbed(idOrUrl) {
  try {
    const u = new URL(idOrUrl, 'https://example.com');
    const host = u.hostname.replace(/^www\./, '');
    if (host.includes('youtu')) {
      // youtu.be/<id>
      if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${u.pathname.replace(/^\//,'')}`;
      // youtube.com/watch?v=<id>
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
      // youtube.com/embed/<id>
      const m = u.pathname.match(/\/embed\/([^/?#]+)/);
      if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
    }
  } catch (_) {
    /* not a URL, treat as ID */
  }
  // Fallback: treat as raw ID
  return `https://www.youtube-nocookie.com/embed/${idOrUrl}`;
}

function toVimeoEmbed(idOrUrl) {
  try {
    const u = new URL(idOrUrl, 'https://example.com');
    const host = u.hostname.replace(/^www\./, '');
    if (host.endsWith('vimeo.com')) {
      // player.vimeo.com/video/<id>
      const m1 = u.pathname.match(/\/video\/([^/?#]+)/);
      if (m1) return `https://player.vimeo.com/video/${m1[1]}`;
      // vimeo.com/<id>
      const m2 = u.pathname.match(/^\/([^/?#]+)/);
      if (m2) return `https://player.vimeo.com/video/${m2[1]}`;
    }
  } catch (_) {
    /* not a URL, treat as ID */
  }
  return `https://player.vimeo.com/video/${idOrUrl}`;
}

function buildEmbedFigure(src, caption) {
  const safeCaption = caption ? escapeHtml(caption) : '';
  const figcap = safeCaption ? `<figcaption>${safeCaption}</figcaption>` : '';
  return `\n\n<figure class="post-figure"><iframe src="${escapeHtml(src)}" title="${safeCaption || 'Video'}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>${figcap}</figure>\n\n`;
}

function applyShortcodes(md) {
  // {{ youtube: ID_OR_URL "Optional caption" }}
  md = md.replace(/\{\{\s*youtube\s*:\s*(\S+)(?:\s+"([^"]*)")?\s*\}\}/gi, (_m, idOrUrl, cap) => {
    const src = toYouTubeEmbed(idOrUrl);
    return buildEmbedFigure(src, cap);
  });
  // {{ vimeo: ID_OR_URL "Optional caption" }}
  md = md.replace(/\{\{\s*vimeo\s*:\s*(\S+)(?:\s+"([^"]*)")?\s*\}\}/gi, (_m, idOrUrl, cap) => {
    const src = toVimeoEmbed(idOrUrl);
    return buildEmbedFigure(src, cap);
  });
  return md;
}

function markdownToHtml(md) {
  // Configure marked for minimalist output
  if (window.marked) {
    // Expand custom shortcodes before Markdown parsing
    md = applyShortcodes(md);
    const renderer = new marked.Renderer();
    renderer.image = (href, title, text) => {
      let src = href;
      let alt = text;
      let caption = title;
      if (href && typeof href === 'object') {
        const token = href;
        src = token.href;
        caption = token.title;
        alt = token.text || token.raw || '';
      }
      const safeSrc = escapeHtml(src);
      const safeAlt = escapeHtml(alt);
      const safeCaption = caption ? escapeHtml(caption) : '';
      const titleAttr = safeCaption ? ` title="${safeCaption}"` : '';
      const captionHtml = safeCaption ? `<figcaption>${safeCaption}</figcaption>` : '';
      return `<figure class="post-figure"><img src="${safeSrc}" alt="${safeAlt}"${titleAttr} loading="lazy">${captionHtml}</figure>`;
    };
    const options = {
      gfm: true,
      breaks: false,
      headerIds: true,
      mangle: false,
      renderer
    };
    marked.setOptions(options);
    if (typeof marked.use === 'function') {
      marked.use({ renderer });
    }
    return typeof marked.parse === 'function' ? marked.parse(md) : marked(md);
  }
  // Fallback: escape
  const div = document.createElement('div');
  div.textContent = md;
  return `<pre>${div.innerHTML}</pre>`;
}

// Configure DOMPurify once to safely allow trusted video iframes
function configureSanitizerForEmbeds() {
  if (!window.DOMPurify) return;
  if (window.__VIBE_SANITIZER_CONFIGURED) return;
  window.__VIBE_SANITIZER_CONFIGURED = true;

  const allowedIframeHosts = new Set([
    'www.youtube.com',
    'youtube.com',
    'www.youtube-nocookie.com',
    'youtube-nocookie.com',
    'player.vimeo.com'
  ]);

  // Remove disallowed iframes and enforce safe defaults on allowed ones
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName && data.tagName.toLowerCase() === 'iframe') {
      const src = node.getAttribute('src') || '';
      try {
        const url = new URL(src, location.origin);
        const host = url.hostname.toLowerCase();
        const isYouTube = host.includes('youtube');
        const isVimeo = host === 'player.vimeo.com';
        const pathOk = isYouTube ? url.pathname.startsWith('/embed/') : true;
        const allowed = allowedIframeHosts.has(host) && pathOk;
        if (!allowed) {
          node.parentNode && node.parentNode.removeChild(node);
          return;
        }
        // Safe defaults
        if (!node.hasAttribute('loading')) node.setAttribute('loading', 'lazy');
        if (!node.hasAttribute('referrerpolicy')) node.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        node.setAttribute('allowfullscreen', '');
        const allowDefault = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        if (!node.getAttribute('allow')) node.setAttribute('allow', allowDefault);
      } catch (_e) {
        node.parentNode && node.parentNode.removeChild(node);
      }
    }
  });

  // Block javascript: URLs on iframe src explicitly
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (node.nodeName === 'IFRAME' && data.attrName === 'src') {
      if (/^javascript:/i.test(data.attrValue || '')) data.keepAttr = false;
    }
  });
}

function sanitize(html) {
  if (!window.DOMPurify) return html;
  // Ensure hooks/allowances are registered once
  configureSanitizerForEmbeds();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // Keep figure elements for images and video captions
    ADD_TAGS: ['figure', 'figcaption', 'iframe'],
    ADD_ATTR: [
      'class', 'loading',
      // iframe-safe attributes
      'src', 'title', 'width', 'height', 'allow', 'allowfullscreen', 'referrerpolicy', 'sandbox'
    ]
  });
}

function renderMathIn(el) {
  if (!window.renderMathInElement) return;
  renderMathInElement(el, {
    // Custom delimiters per user request
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false }
    ],
    throwOnError: false,
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
  });
}

async function loadPost(type, slug) {
  const mdPath = `content/${type}/${slug}.md`;
  const raw = await fetchText(mdPath);
  const { meta, body } = parseFrontmatter(raw);
  document.title = meta.title ? `Matthew - ${meta.title}` : 'Matthew - Post';

  const main = document.querySelector('main');
  const header = document.createElement('header');
  header.innerHTML = `
    <h1>${meta.title || slug}</h1>
    ${meta.subtitle ? `<div class="subtitle">${meta.subtitle}</div>` : ''}
    ${meta.date ? `<div class="post-meta">${formatDate(meta.date)}</div>` : ''}
  `;

  const html = sanitize(markdownToHtml(body));
  const article = document.createElement('article');
  article.className = 'post';
  article.appendChild(header);
  const content = document.createElement('div');
  content.className = 'post-content';
  content.innerHTML = html;
  article.appendChild(content);
  main.innerHTML = '';
  main.appendChild(article);
  renderMathIn(article);
}

async function loadPage(slug) {
  const mdPath = `content/pages/${slug}.md`;
  const raw = await fetchText(mdPath);
  const { meta, body } = parseFrontmatter(raw);
  document.title = meta.title ? `Matthew - ${meta.title}` : 'Matthew - Page';

  const main = document.querySelector('main');
  const header = document.createElement('header');
  header.innerHTML = `
    <h1>${meta.title || slug}</h1>
    ${meta.subtitle ? `<div class="subtitle">${meta.subtitle}</div>` : ''}
  `;
  const html = sanitize(markdownToHtml(body));
  const article = document.createElement('article');
  article.className = 'post';
  article.appendChild(header);
  const content = document.createElement('div');
  content.className = 'post-content';
  content.innerHTML = html;
  article.appendChild(content);
  main.innerHTML = '';
  main.appendChild(article);
  renderMathIn(article);
}

async function loadList(type) {
  const listPath = `content/${type}/index.json`;
  const { posts } = await fetchJSON(listPath);
  const main = document.querySelector('main');
  const ul = document.createElement('div');
  ul.className = 'post-list';
  posts
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .forEach(p => {
      const item = document.createElement('div');
      item.className = 'post-item';
      item.innerHTML = `
        <div>
          <a href="post.html?type=${type}&slug=${encodeURIComponent(p.slug)}"><strong>${p.title}</strong></a>
        </div>
        ${p.subtitle ? `<div class="subtitle">${p.subtitle}</div>` : ''}
        ${p.date ? `<div class="meta">${formatDate(p.date)}</div>` : ''}
      `;
      ul.appendChild(item);
    });
  main.innerHTML = '';
  main.appendChild(ul);
}

// Expose for page scripts
window.Vibe = { loadPost, loadPage, loadList };
