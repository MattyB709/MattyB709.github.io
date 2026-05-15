// Shared site utilities

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  } catch { return iso; }
}

function currentNavHref(url = new URL(location.href)) {
  const pathname = url.pathname;
  if (pathname.endsWith('projects.html')) return 'projects.html';
  if (pathname.endsWith('post.html') && url.searchParams.get('type') === 'projects') return 'projects.html';
  if (pathname.endsWith('index.html') || pathname === '/' || pathname.endsWith('/')) return 'index.html';
  return null;
}

function setActiveNav(pathname) {
  const activeHref = currentNavHref(new URL(location.href));
  $all('header .nav a').forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    if ((activeHref && href === activeHref) || pathname.endsWith(href)) {
      a.classList.add('active');
    }
  });
}

function headerTemplate() {
  return `
  <header class="site-header">
    <div class="container">
      <nav class="nav">
        <a href="index.html">Home</a>
        <a href="projects.html">Projects</a>
      </nav>
    </div>
  </header>`;
}

function footerTemplate() {
  return `
  <footer class="site-footer">
    <div class="container">
      <div>Matthew Builes · <a href="mailto:matthew.builes8@gmail.com">matthew.builes8@gmail.com</a> · <a href="https://github.com/MattyB709">GitHub</a> · <a href="https://www.linkedin.com/in/matthew-builes-8a0664270">LinkedIn</a></div>
    </div>
  </footer>`;
}

function mountChrome() {
  const hasHeader = document.querySelector('header.site-header');
  const hasFooter = document.querySelector('footer.site-footer');
  if (!hasHeader) {
    const top = document.createElement('div');
    top.innerHTML = headerTemplate();
    document.body.prepend(top.firstElementChild);
  }
  if (!hasFooter) {
    const foot = document.createElement('div');
    foot.innerHTML = footerTemplate();
    document.body.append(foot.firstElementChild);
  }
  setActiveNav(location.pathname);
}

document.addEventListener('DOMContentLoaded', mountChrome);
