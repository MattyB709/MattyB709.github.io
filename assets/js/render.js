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

function markdownToHtml(md) {
  // Configure marked for minimalist output
  if (window.marked) {
    marked.setOptions({
      gfm: true,
      breaks: false,
      headerIds: true,
      mangle: false
    });
    return marked.parse(md);
  }
  // Fallback: escape
  const div = document.createElement('div');
  div.textContent = md;
  return `<pre>${div.innerHTML}</pre>`;
}

function sanitize(html) {
  return window.DOMPurify ? DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) : html;
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
