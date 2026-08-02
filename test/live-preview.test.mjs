import { readFile } from 'node:fs/promises';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { buildPreviewDecorations, collectPreviewTokens, findFrontmatter, initialCursorPosition, livePreview, moveIntoAdjacentMath } from '../tools/editor/live-preview.js';

function stateFor(doc, anchor = 0) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage, extensions: [GFM] })]
  });
}

describe('live Markdown preview', () => {
  it('recognizes frontmatter and replaces it away from the cursor', () => {
    const doc = '---\ntitle: Example\ndate: 2026-08-01\n---\n\nBody';
    expect(initialCursorPosition(doc)).toBe(doc.indexOf('Body'));
    expect(findFrontmatter(doc)?.source).toContain('title: Example');
    const tokens = collectPreviewTokens(stateFor(doc, doc.indexOf('Body')));
    expect(tokens).toContainEqual(expect.objectContaining({ kind: 'widget', type: 'frontmatter' }));
  });

  it('hides heading markup except on the active source line', () => {
    const doc = '# Heading\n\nBody';
    const inactive = collectPreviewTokens(stateFor(doc, doc.indexOf('Body')));
    expect(inactive).toContainEqual(expect.objectContaining({ kind: 'hide', from: 0, to: 1 }));

    const active = collectPreviewTokens(stateFor(doc, 3));
    expect(active).not.toContainEqual(expect.objectContaining({ kind: 'hide', from: 0, to: 1 }));
  });

  it('keeps a URL-shaped link label visible while hiding its destination', () => {
    const doc = 'Cursor\n\n[https://example.com](https://example.com)';
    const tokens = collectPreviewTokens(stateFor(doc, 0));
    const labelFrom = doc.indexOf('https://');
    const destinationFrom = doc.lastIndexOf('https://');
    const hidden = tokens.filter(token => token.kind === 'hide');
    expect(hidden).not.toContainEqual(expect.objectContaining({ from: labelFrom }));
    expect(hidden).toContainEqual(expect.objectContaining({ from: destinationFrom }));
  });

  it('keeps fenced code as native editable lines', () => {
    const doc = 'Before\n\n```js\nconst x = 1;\n```\n\nAfter';
    const fenceStart = doc.indexOf('```');
    const active = collectPreviewTokens(stateFor(doc, doc.indexOf('const')));
    expect(active).not.toContainEqual(expect.objectContaining({ kind: 'hide', from: fenceStart }));

    const inactive = collectPreviewTokens(stateFor(doc, doc.indexOf('After')));
    expect(inactive).not.toContainEqual(expect.objectContaining({ kind: 'widget', type: 'block', source: expect.stringContaining('const x = 1') }));
    expect(inactive).toContainEqual(expect.objectContaining({ kind: 'hide', from: fenceStart }));
    expect(inactive).toContainEqual(expect.objectContaining({ kind: 'line', className: expect.stringContaining('cm-live-code-line') }));
  });

  it('renders tables, images, math, and embeds as widgets when inactive', () => {
    const doc = [
      'Cursor', '',
      '| A | B |', '|---|---|', '| 1 | 2 |', '',
      '![alt](assets/image.png "Caption")', '',
      '$x^2$', '',
      '{{ youtube: abc "Video" }}'
    ].join('\n');
    const tokens = collectPreviewTokens(stateFor(doc, 0));
    expect(tokens.map(token => token.type).filter(Boolean)).toEqual(expect.arrayContaining(['table', 'image', 'math-inline', 'embed']));
    expect(() => buildPreviewDecorations(stateFor(doc, 0))).not.toThrow();
  });

  it('classifies single-dollar math as an inline widget', () => {
    const doc = 'Cursor\n\nMath $x$ stays in this sentence.';
    const tokens = collectPreviewTokens(stateFor(doc, 0));
    expect(tokens).toContainEqual(expect.objectContaining({ type: 'math-inline', source: '$x$' }));
  });

  it('moves vertically into display math instead of skipping its source', () => {
    const doc = 'Before\n$$x = y$$\n```rust\ncode\n```';
    const mathFrom = doc.indexOf('$$');
    const mathTo = doc.indexOf('$$', mathFrom + 2) + 2;

    let dispatched;
    const movedDown = moveIntoAdjacentMath({
      state: stateFor(doc, doc.indexOf('\n')),
      moveVertically: () => ({ head: doc.indexOf('```') }),
      dispatch: transaction => { dispatched = transaction; }
    }, true);
    expect(movedDown).toBe(true);
    expect(dispatched.selection.anchor).toBe(mathFrom + 2);

    dispatched = undefined;
    const movedUp = moveIntoAdjacentMath({
      state: stateFor(doc, doc.indexOf('code')),
      moveVertically: () => ({ head: 0 }),
      dispatch: transaction => { dispatched = transaction; }
    }, false);
    expect(movedUp).toBe(true);
    expect(dispatched.selection.anchor).toBe(mathTo - 2);
  });

  it('constructs an editor with block previews for the full PPE post', async () => {
    const dom = new JSDOM('<!doctype html><div id="editor"></div>', {
      pretendToBeVisual: true,
      url: 'http://127.0.0.1/'
    });
    const browser = dom.window;
    globalThis.window = browser;
    globalThis.document = browser.document;
    Object.defineProperty(globalThis, 'navigator', { value: browser.navigator, configurable: true });
    for (const key of ['MutationObserver', 'HTMLElement', 'Element', 'Node', 'DOMRect']) {
      globalThis[key] = browser[key];
    }
    globalThis.getComputedStyle = browser.getComputedStyle.bind(browser);
    globalThis.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
    globalThis.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
    browser.Vibe = {
      parseFrontmatter: () => ({ meta: { title: 'PPE' } }),
      renderMarkdown: source => `<p>${source}</p>`,
      renderMathIn: () => {}
    };
    browser.formatDate = value => value;

    const doc = await readFile('content/projects/ppe.md', 'utf8');
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf('# Abstract') },
      extensions: [markdown({ base: markdownLanguage, extensions: [GFM] }), livePreview]
    });
    const view = new EditorView({ state, parent: browser.document.querySelector('#editor') });
    expect(view.dom.querySelector('.cm-rendered-frontmatter h1')?.textContent).toBe('PPE');
    expect(view.dom.querySelectorAll('.cm-rendered-widget').length).toBeGreaterThan(0);
    view.destroy();
    const inlineMath = view.dom.querySelector('.cm-rendered-math-inline');
    expect(inlineMath?.tagName).toBe('SPAN');
    expect(inlineMath?.querySelector('p')).toBeNull();
  });
});
