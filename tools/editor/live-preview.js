import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

function overlaps(from, to, ranges) {
  return ranges.some(range => from <= range.to && to > range.from);
}

function activeLineRanges(state) {
  return state.selection.ranges.map(selection => {
    const start = state.doc.lineAt(selection.from);
    const end = state.doc.lineAt(selection.to);
    return { from: start.from, to: end.to };
  });
}

export function findFrontmatter(doc) {
  const text = typeof doc === 'string' ? doc : doc.toString();
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return null;
  const match = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/.exec(text);
  return match ? { from: 0, to: match[0].length, source: match[0] } : null;
}

export function initialCursorPosition(doc) {
  const frontmatter = findFrontmatter(doc);
  if (!frontmatter) return 0;
  const trailingNewlines = doc.slice(frontmatter.to).match(/^(?:\r?\n)+/);
  return Math.min(doc.length, frontmatter.to + (trailingNewlines?.[0].length || 0));
}

function specialWidgetRanges(text, excluded) {
  const candidates = [];
  const patterns = [
    { type: 'math-block', expression: /\$\$[\s\S]*?\$\$/g },
    { type: 'math-inline', expression: /(^|[^\\$])(\$(?!\$)(?:\\.|[^\\$\n])+(?<!\\)\$)/gm, group: 2 },
    { type: 'embed', expression: /\{\{\s*(?:youtube|vimeo)\s*:\s*\S+(?:\s+"[^"]*")?\s*\}\}/gi }
  ];
  for (const { type, expression, group } of patterns) {
    for (const match of text.matchAll(expression)) {
      const source = group ? match[group] : match[0];
      const from = match.index + (group ? match[0].indexOf(source) : 0);
      const to = from + source.length;
      if (!overlaps(from, to, excluded) && !overlaps(from, to, candidates)) {
        candidates.push({ kind: 'widget', type, from, to, source });
      }
    }
  }
  return candidates.sort((a, b) => a.from - b.from);
}

export function collectPreviewTokens(state) {
  const activeLines = activeLineRanges(state);
  const frontmatter = findFrontmatter(state.doc);
  const blockRanges = [];
  const codeRanges = [];
  const tokens = [];

  syntaxTree(state).iterate({
    enter(node) {
      const previewBlocks = new Set(['FencedCode', 'Table', 'Blockquote', 'BulletList', 'OrderedList']);
      if (previewBlocks.has(node.name)) {
        const range = { from: node.from, to: node.to, type: node.name };
        blockRanges.push(range);
        if (node.name === 'FencedCode') codeRanges.push(range);
      }
    }
  });

  const expandedActive = [...activeLines];
  for (const block of blockRanges) {
    if (overlaps(block.from, block.to, activeLines)) expandedActive.push(block);
  }
  if (frontmatter && overlaps(frontmatter.from, frontmatter.to, activeLines)) expandedActive.push(frontmatter);

  if (frontmatter && !overlaps(frontmatter.from, frontmatter.to, expandedActive)) {
    tokens.push({ kind: 'widget', type: 'frontmatter', ...frontmatter });
  }

  syntaxTree(state).iterate({
    enter(node) {
      if (frontmatter && node.from >= frontmatter.from && node.to <= frontmatter.to) return false;
      const active = overlaps(node.from, node.to, expandedActive);
      const renderedBlocks = new Set(['Blockquote', 'BulletList', 'OrderedList']);
      if (renderedBlocks.has(node.name) && !active) {
        tokens.push({ kind: 'widget', type: 'block', from: node.from, to: node.to, source: state.sliceDoc(node.from, node.to) });
        return false;
      }
      if (node.name === 'Image' && !active) {
        tokens.push({ kind: 'widget', type: 'image', from: node.from, to: node.to, source: state.sliceDoc(node.from, node.to) });
        return false;
      }
      if (node.name === 'HorizontalRule' && !active) {
        tokens.push({ kind: 'widget', type: 'rule', from: node.from, to: node.to, source: state.sliceDoc(node.from, node.to) });
        return false;
      }
      if (node.name === 'ListMark' && !active) {
        tokens.push({ kind: 'widget', type: 'list-mark', from: node.from, to: node.to, source: state.sliceDoc(node.from, node.to) });
        return false;
      }
      if (node.name === 'Table' && !active) {
        tokens.push({ kind: 'widget', type: 'table', from: node.from, to: node.to, source: state.sliceDoc(node.from, node.to) });
        return false;
      }
      if (/^ATXHeading[1-6]$/.test(node.name)) {
        const level = node.name.at(-1);
        tokens.push({ kind: 'line', from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.from).from, className: `cm-live-heading-${level}` });
      }
      if (node.name === 'StrongEmphasis') {
        tokens.push({ kind: 'mark', from: node.from, to: node.to, className: 'cm-live-strong' });
      } else if (node.name === 'Emphasis') {
        tokens.push({ kind: 'mark', from: node.from, to: node.to, className: 'cm-live-emphasis' });
      } else if (node.name === 'Link') {
        tokens.push({ kind: 'mark', from: node.from, to: node.to, className: 'cm-live-link' });
      } else if (node.name === 'InlineCode') {
        tokens.push({ kind: 'mark', from: node.from, to: node.to, className: 'cm-live-inline-code' });
      } else if (node.name === 'FencedCode') {
        tokens.push({ kind: 'mark', from: node.from, to: node.to, className: 'cm-live-code-block' });
        const firstLine = state.doc.lineAt(node.from);
        const lastLine = state.doc.lineAt(node.to);
        for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
          const line = state.doc.line(lineNumber);
          const edgeClass = lineNumber === firstLine.number
            ? ' cm-live-code-first'
            : lineNumber === lastLine.number ? ' cm-live-code-last' : '';
          tokens.push({ kind: 'line', from: line.from, to: line.from, className: `cm-live-code-line${edgeClass}` });
        }
      } else if (node.name === 'Blockquote') {
        tokens.push({ kind: 'mark', from: node.from, to: node.to, className: 'cm-live-blockquote' });
      }
      const hidden = new Set(['HeaderMark', 'EmphasisMark', 'LinkMark', 'CodeMark', 'CodeInfo', 'QuoteMark']);
      const isLinkDestination = node.name === 'URL' && state.sliceDoc(Math.max(0, node.from - 1), node.from) === '(';
      if (!active && (hidden.has(node.name) || isLinkDestination)) {
        tokens.push({ kind: 'hide', from: node.from, to: node.to });
      }
    }
  });

  const excluded = [
    ...(frontmatter ? [frontmatter] : []),
    ...codeRanges,
    ...tokens.filter(token => token.kind === 'widget')
  ];
  for (const token of specialWidgetRanges(state.doc.toString(), excluded)) {
    if (!overlaps(token.from, token.to, expandedActive)) tokens.push(token);
  }
  return tokens;
}

class RenderedWidget extends WidgetType {
  constructor(type, source, position, block = false) {
    super();
    this.type = type;
    this.source = source;
    this.position = position;
    this.block = block;
  }

  eq(other) {
    return this.type === other.type && this.source === other.source && this.position === other.position && this.block === other.block;
  }

  toDOM() {
    const blockTypes = new Set(['frontmatter', 'table', 'block', 'rule']);
    const wrapper = document.createElement(blockTypes.has(this.type) ? 'div' : 'span');
    wrapper.className = `cm-rendered-widget cm-rendered-${this.type}`;
    const delimiterOffset = this.type === 'math-block' ? 2 : this.type === 'math-inline' ? 1 : 0;
    wrapper.dataset.sourcePos = String(this.position + delimiterOffset);
    if (this.type === 'frontmatter') {
      const { meta } = window.Vibe.parseFrontmatter(`${this.source}\n`);
      const title = document.createElement('h1');
      title.textContent = meta.title || meta.slug || 'Post properties';
      wrapper.append(title);
      if (meta.subtitle) {
        const subtitle = document.createElement('div');
        subtitle.className = 'subtitle';
        subtitle.textContent = meta.subtitle;
        wrapper.append(subtitle);
      }
      if (meta.date) {
        const date = document.createElement('div');
        date.className = 'post-meta';
        date.textContent = window.formatDate(meta.date);
        wrapper.append(date);
      }
    } else if (this.type === 'list-mark') {
      wrapper.classList.add('cm-rendered-list-mark');
      wrapper.textContent = /^\d/.test(this.source) ? this.source : '•';
    } else if (this.type === 'math-inline' || this.type === 'math-block') {
      wrapper.textContent = this.source;
      window.Vibe.renderMathIn(wrapper);
    } else {
      wrapper.innerHTML = window.Vibe.renderMarkdown(this.source);
      window.Vibe.renderMathIn(wrapper);
    }
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

export function buildPreviewDecorations(state) {
  const ranges = collectPreviewTokens(state).map(token => {
    if (token.kind === 'line') return Decoration.line({ class: token.className }).range(token.from);
    if (token.kind === 'mark') return Decoration.mark({ class: token.className }).range(token.from, token.to);
    if (token.kind === 'hide') return Decoration.replace({}).range(token.from, token.to);
    const startLine = state.doc.lineAt(token.from);
    const endLine = state.doc.lineAt(token.to);
    const block = token.from === startLine.from && token.to === endLine.to && token.type !== 'math-inline';
    return Decoration.replace({
      widget: new RenderedWidget(token.type, token.source, token.from, block),
      block
    }).range(token.from, token.to);
  });
  return Decoration.set(ranges, true);
}

function sourcePositionAtPoint(view, event) {
  let node;
  let offset;
  if (document.caretPositionFromPoint) {
    const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
    node = caret?.offsetNode;
    offset = caret?.offset;
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(event.clientX, event.clientY);
    node = range?.startContainer;
    offset = range?.startOffset;
  }
  if (!node || offset === undefined) return null;
  try {
    return view.posAtDOM(node, offset);
  } catch {
    return null;
  }
}

export const livePreview = [
  // Block replacements must come from state; CodeMirror rejects them from view plugins.
  EditorView.decorations.compute(['doc', 'selection'], buildPreviewDecorations),
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const code = event.target.closest?.('.cm-live-code-block');
      const codePosition = code ? sourcePositionAtPoint(view, event) : null;
      if (codePosition !== null) {
        view.dispatch({ selection: { anchor: codePosition }, scrollIntoView: true });
        view.focus();
        event.preventDefault();
        return true;
      }
      const widget = event.target.closest?.('[data-source-pos]');
      if (!widget) return false;
      const position = Number(widget.dataset.sourcePos);
      view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
      view.focus();
      event.preventDefault();
      return true;
    }
  })
];

export function moveIntoAdjacentMath(view, forward) {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const nativeTarget = view.moveVertically(selection, forward);
  if (nativeTarget.head === selection.head) return false;

  const candidates = collectPreviewTokens(view.state)
    .filter(token => token.kind === 'widget' && token.type === 'math-block')
    .filter(token => forward
      ? token.from >= selection.head && token.from < nativeTarget.head
      : token.to <= selection.head && token.to > nativeTarget.head)
    .sort((left, right) => forward ? left.from - right.from : right.to - left.to);
  const target = candidates[0];
  if (!target) return false;

  const delimiterLength = target.source.startsWith('$$') ? 2 : 0;
  const anchor = forward
    ? Math.min(target.to, target.from + delimiterLength)
    : Math.max(target.from, target.to - delimiterLength);
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
  return true;
}
