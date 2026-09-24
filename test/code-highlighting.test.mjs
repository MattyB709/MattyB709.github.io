import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { GFM } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { codeHighlightStyle, codeLanguages } from '../tools/editor/code-highlighting.js';

describe('editable fenced-code highlighting', () => {
  it('loads and parses the language named by a Rust fence', async () => {
    const rust = codeLanguages.find(language => language.name === 'Rust');
    expect(rust).toBeDefined();
    await rust.load();

    const doc = '```rust\nfn main() { let answer = 42; }\n```';
    const state = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, codeLanguages, extensions: [GFM] })]
    });

    expect(syntaxTree(state).resolveInner(doc.indexOf('fn'), 1).name).toBe('fn');
    expect(syntaxTree(state).resolveInner(doc.indexOf('main'), 1).name).toBe('BoundIdentifier');
    expect(codeHighlightStyle.style([tags.keyword])).toBeTruthy();
    expect(codeHighlightStyle.style([tags.string])).not.toBe(codeHighlightStyle.style([tags.keyword]));
  });
});
