import { HighlightStyle } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';

export const codeLanguages = languages;

export const codeHighlightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword], color: 'var(--syntax-keyword)', fontWeight: '700' },
  { tag: [tags.string, tags.character, tags.regexp, tags.escape], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: [tags.typeName, tags.className, tags.standard(tags.typeName)], color: 'var(--syntax-type)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.variableName)], color: 'var(--syntax-function)' },
  { tag: [tags.meta, tags.attributeName, tags.propertyName, tags.special(tags.variableName)], color: 'var(--syntax-meta)' }
]);
