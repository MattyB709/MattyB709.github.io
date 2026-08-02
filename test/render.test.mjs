import { readFile } from 'node:fs/promises';
import path from 'node:path';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let window;
let Vibe;
let renderMathInElement;

beforeEach(async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1:4173/'
  });
  window = dom.window;
  window.marked = marked;
  window.DOMPurify = createDOMPurify(window);
  window.formatDate = value => value;
  renderMathInElement = vi.fn();
  window.renderMathInElement = renderMathInElement;
  const source = await readFile(path.resolve('assets/js/render.js'), 'utf8');
  window.eval(source);
  Vibe = window.Vibe;
});

describe('shared site renderer', () => {
  it('parses the repository frontmatter format', () => {
    const parsed = Vibe.parseFrontmatter('---\nslug: sample\ntitle: "A title"\ndate: 2026-08-01\n---\n\nBody');
    expect(parsed.meta).toEqual({ slug: 'sample', title: 'A title', date: '2026-08-01' });
    expect(parsed.body).toBe('Body');
  });

  it('renders GFM tables and image captions', () => {
    const html = Vibe.renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n\n![Alt](assets/image.png "Caption")');
    expect(html).toContain('<table>');
    expect(html).toContain('<figure class="post-figure">');
    expect(html).toContain('<figcaption>Caption</figcaption>');
  });

  it('renders approved embeds and strips unsafe HTML', () => {
    const youtube = Vibe.renderMarkdown('{{ youtube: abc123 "Demo" }}');
    expect(youtube).toContain('https://www.youtube-nocookie.com/embed/abc123');
    expect(youtube).toContain('<figcaption>Demo</figcaption>');

    const unsafe = Vibe.renderMarkdown('<img src="x" onerror="alert(1)"><iframe src="https://evil.example/embed/x"></iframe>');
    expect(unsafe).not.toContain('onerror');
    expect(unsafe).not.toContain('evil.example');
  });

  it('builds a complete escaped post and invokes the existing math renderer', () => {
    const raw = '---\ntitle: <img src=x onerror=alert(1)>\nsubtitle: Safe subtitle\ndate: 2026-08-01\n---\n\nMath: $x^2$';
    const { article } = Vibe.buildPostArticle(raw, 'fallback');
    expect(article.querySelector('h1').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(article.querySelector('h1 img')).toBeNull();
    expect(article.querySelector('.post-content').textContent).toContain('Math: $x^2$');
    expect(renderMathInElement).toHaveBeenCalledOnce();
    expect(renderMathInElement.mock.calls[0][1].delimiters).toEqual(expect.arrayContaining([
      expect.objectContaining({ left: '$$', right: '$$', display: true }),
      expect.objectContaining({ left: '$', right: '$', display: false })
    ]));
  });
});
