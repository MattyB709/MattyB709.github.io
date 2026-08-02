import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, foldKeymap, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, dropCursor, highlightSpecialChars, keymap } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { initialCursorPosition, livePreview, moveIntoAdjacentMath } from './live-preview.js';

const API_ROOT = '/__editor/api';
const AUTOSAVE_DELAY = 750;

const elements = {
  editor: document.querySelector('#editor'),
  welcome: document.querySelector('#welcome'),
  fileList: document.querySelector('#file-list'),
  currentFile: document.querySelector('#current-file'),
  saveState: document.querySelector('#save-state'),
  save: document.querySelector('#save-file'),
  reload: document.querySelector('#reload-file'),
  preview: document.querySelector('#site-preview'),
  previewDialog: document.querySelector('#preview-dialog'),
  previewContent: document.querySelector('#preview-content'),
  newPost: document.querySelector('#new-post'),
  newDialog: document.querySelector('#new-post-dialog'),
  newForm: document.querySelector('#new-post-form'),
  newType: document.querySelector('#new-type'),
  newTitle: document.querySelector('#new-title'),
  newSlug: document.querySelector('#new-slug'),
  newSubtitle: document.querySelector('#new-subtitle'),
  newDate: document.querySelector('#new-date'),
  newError: document.querySelector('#new-post-error'),
  sidebarToggle: document.querySelector('#sidebar-toggle')
};

let files = [];
let contentTypes = [];
let currentPath = null;
let currentVersion = null;
let dirty = false;
let conflicted = false;
let suppressChanges = false;
let autosaveTimer = null;
let activeSave = null;
let slugWasEdited = false;
let previewFrame = null;

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(response.status, 'The editor API is unavailable. Start this page with npm run editor.');
  }
  if (!response.ok) throw new ApiError(response.status, payload.error || 'Editor request failed.', payload.details);
  return payload;
}

function setStatus(label, state = 'idle') {
  elements.saveState.textContent = label;
  elements.saveState.dataset.state = state;
  elements.saveState.title = state === 'conflict' ? 'The file changed outside this editor. Reload it before continuing.' : '';
}

function setControlsEnabled(enabled) {
  elements.save.disabled = !enabled;
  elements.reload.disabled = !enabled;
  elements.preview.disabled = !enabled;
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function localIsoDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function safeFrontmatterValue(value) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function postTemplate({ slug, title, subtitle, date }) {
  const lines = ['---', `slug: ${slug}`, `title: ${safeFrontmatterValue(title)}`];
  if (subtitle.trim()) lines.push(`subtitle: ${safeFrontmatterValue(subtitle)}`);
  lines.push(`date: ${date}`, '---', '', '# Start writing', '', '');
  return lines.join('\n');
}

function renderFileList() {
  elements.fileList.innerHTML = '';
  if (!files.length) {
    elements.fileList.innerHTML = '<p class="empty-message">No Markdown files found.</p>';
    return;
  }
  const groups = new Map();
  for (const file of files) {
    if (!groups.has(file.type)) groups.set(file.type, []);
    groups.get(file.type).push(file);
  }
  for (const [type, typeFiles] of groups) {
    const section = document.createElement('section');
    section.className = 'file-group';
    const heading = document.createElement('h2');
    heading.textContent = type;
    section.append(heading);
    for (const file of typeFiles) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'file-button';
      button.dataset.path = file.path;
      button.textContent = file.slug;
      button.title = file.path;
      button.classList.toggle('active', file.path === currentPath);
      button.addEventListener('click', () => openFile(file.path));
      section.append(button);
    }
    elements.fileList.append(section);
  }
}

function renderSitePreview() {
  if (!currentPath || !elements.previewDialog.open) return;
  elements.previewContent.innerHTML = '';
  const slug = currentPath.split('/').at(-1).replace(/\.md$/i, '');
  const { article } = window.Vibe.buildPostArticle(view.state.doc.toString(), slug);
  elements.previewContent.append(article);
}

function schedulePreview() {
  if (!elements.previewDialog.open || previewFrame) return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = null;
    renderSitePreview();
  });
}

const view = new EditorView({
  parent: elements.editor,
  state: EditorState.create({
    doc: '',
    extensions: [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage, extensions: [GFM] }),
      livePreview,
      EditorState.tabSize.of(2),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ class: 'post-content' }),
      keymap.of([
        { key: 'Mod-s', run: () => { saveNow(); return true; } },
        indentWithTab,
        { key: 'ArrowDown', run: editor => moveIntoAdjacentMath(editor, true) },
        { key: 'ArrowUp', run: editor => moveIntoAdjacentMath(editor, false) },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap
      ]),
      EditorView.updateListener.of(update => {
        if (!update.docChanged || suppressChanges || !currentPath) return;
        dirty = true;
        conflicted = false;
        setStatus('Unsaved', 'dirty');
        scheduleAutosave();
        schedulePreview();
      })
    ]
  })
});

function replaceEditorContent(content) {
  suppressChanges = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    selection: { anchor: initialCursorPosition(content) },
    scrollIntoView: true
  });
  suppressChanges = false;
}

async function refreshFiles() {
  const payload = await api('/files');
  files = payload.files;
  contentTypes = payload.types;
  renderFileList();
  elements.newType.innerHTML = '';
  for (const type of contentTypes) {
    const option = document.createElement('option');
    option.value = option.textContent = type;
    elements.newType.append(option);
  }
  elements.newPost.disabled = !contentTypes.length;
}

async function openFile(path, { discard = false } = {}) {
  if (path === currentPath && !discard) return;
  if (dirty && !discard) {
    await saveNow();
    if (dirty) return;
  }
  clearTimeout(autosaveTimer);
  try {
    setStatus('Loading…');
    const payload = await api(`/file?path=${encodeURIComponent(path)}`);
    currentPath = payload.path;
    currentVersion = payload.version;
    dirty = false;
    conflicted = false;
    replaceEditorContent(payload.content);
    elements.currentFile.textContent = `content/${currentPath}`;
    elements.welcome.classList.add('hidden');
    setControlsEnabled(true);
    setStatus('Saved', 'saved');
    renderFileList();
    document.body.classList.remove('sidebar-open');
    view.focus();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveNow, AUTOSAVE_DELAY);
}

async function saveNow() {
  clearTimeout(autosaveTimer);
  if (!currentPath || !dirty || conflicted) return activeSave;
  if (activeSave) {
    await activeSave;
    if (dirty && !conflicted) return saveNow();
    return;
  }
  const pathAtSave = currentPath;
  const versionAtSave = currentVersion;
  const contentAtSave = view.state.doc.toString();
  setStatus('Saving…', 'saving');
  activeSave = api('/file', {
    method: 'PUT',
    body: JSON.stringify({ path: pathAtSave, version: versionAtSave, content: contentAtSave })
  });
  try {
    const payload = await activeSave;
    if (currentPath === pathAtSave) {
      currentVersion = payload.version;
      dirty = view.state.doc.toString() !== contentAtSave;
      setStatus(dirty ? 'Unsaved' : 'Saved', dirty ? 'dirty' : 'saved');
    }
  } catch (error) {
    if (error.status === 409) {
      conflicted = true;
      setStatus('Conflict — reload required', 'conflict');
    } else {
      setStatus(`Save failed — ${error.message}`, 'error');
    }
    dirty = true;
  } finally {
    activeSave = null;
  }
  if (dirty && !conflicted && view.state.doc.toString() !== contentAtSave) scheduleAutosave();
}

async function reloadCurrentFile() {
  if (!currentPath) return;
  if (dirty && !window.confirm('Reload the file from disk and discard the changes currently in the editor?')) return;
  await openFile(currentPath, { discard: true });
}

async function createPost(event) {
  event.preventDefault();
  elements.newError.textContent = '';
  const slug = elements.newSlug.value.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    elements.newError.textContent = 'Use lowercase letters, numbers, and single hyphens in the slug.';
    return;
  }
  const path = `${elements.newType.value}/${slug}.md`;
  const content = postTemplate({
    slug,
    title: elements.newTitle.value,
    subtitle: elements.newSubtitle.value,
    date: elements.newDate.value
  });
  try {
    const payload = await api('/files', { method: 'POST', body: JSON.stringify({ path, content }) });
    elements.newDialog.close();
    await refreshFiles();
    currentPath = payload.path;
    currentVersion = payload.version;
    dirty = false;
    conflicted = false;
    replaceEditorContent(payload.content);
    elements.currentFile.textContent = `content/${currentPath}`;
    elements.welcome.classList.add('hidden');
    setControlsEnabled(true);
    setStatus('Saved', 'saved');
    renderFileList();
    view.focus();
  } catch (error) {
    elements.newError.textContent = error.message;
  }
}

elements.save.addEventListener('click', saveNow);
elements.reload.addEventListener('click', reloadCurrentFile);
elements.sidebarToggle.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
elements.preview.addEventListener('click', () => {
  renderSitePreview();
  elements.previewDialog.showModal();
  renderSitePreview();
});
elements.previewDialog.querySelector('[data-close-preview]').addEventListener('click', () => elements.previewDialog.close());
elements.newPost.addEventListener('click', async () => {
  await saveNow();
  if (dirty) return;
  slugWasEdited = false;
  elements.newForm.reset();
  elements.newDate.value = localIsoDate();
  elements.newError.textContent = '';
  elements.newDialog.showModal();
  elements.newTitle.focus();
});
elements.newTitle.addEventListener('input', () => {
  if (!slugWasEdited) elements.newSlug.value = slugify(elements.newTitle.value);
});
elements.newSlug.addEventListener('input', () => { slugWasEdited = true; });
elements.newForm.addEventListener('submit', createPost);
for (const close of elements.newDialog.querySelectorAll('[data-close-dialog]')) {
  close.addEventListener('click', () => elements.newDialog.close());
}
window.addEventListener('beforeunload', event => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

refreshFiles().catch(error => {
  elements.fileList.innerHTML = `<p class="empty-message"></p>`;
  elements.fileList.firstElementChild.textContent = error.message;
  setStatus('Editor API unavailable', 'error');
});
