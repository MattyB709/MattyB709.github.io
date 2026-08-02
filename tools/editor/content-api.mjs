import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

const API_ROOT = '/__editor/api';
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export function contentHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function normalizeMarkdownPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) {
    throw apiError(400, 'A valid Markdown path is required.');
  }
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value) {
    throw apiError(400, 'The path must be normalized and relative to content/.');
  }
  const segments = value.split('/');
  if (segments.length < 2 || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw apiError(400, 'Choose a Markdown file inside a content type.');
  }
  if (path.posix.extname(value).toLowerCase() !== '.md') {
    throw apiError(400, 'Only .md files can be edited.');
  }
  return value;
}

function apiError(status, message, details) {
  return Object.assign(new Error(message), { status, details });
}

async function validateExistingPath(contentRoot, relativePath) {
  const normalized = normalizeMarkdownPath(relativePath);
  const candidate = path.resolve(contentRoot, ...normalized.split('/'));
  if (!isWithin(contentRoot, candidate)) throw apiError(400, 'Path escapes content/.');
  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch (error) {
    if (error.code === 'ENOENT') throw apiError(404, 'Markdown file not found.');
    throw error;
  }
  if (!isWithin(contentRoot, resolved)) throw apiError(400, 'Symlinked files outside content/ are not allowed.');
  const stats = await lstat(candidate);
  if (!stats.isFile() || stats.isSymbolicLink()) throw apiError(400, 'Only regular Markdown files can be edited.');
  return { normalized, candidate };
}

async function validateNewPath(contentRoot, relativePath) {
  const normalized = normalizeMarkdownPath(relativePath);
  const candidate = path.resolve(contentRoot, ...normalized.split('/'));
  const parent = path.dirname(candidate);
  if (!isWithin(contentRoot, candidate)) throw apiError(400, 'Path escapes content/.');
  let resolvedParent;
  try {
    resolvedParent = await realpath(parent);
  } catch (error) {
    if (error.code === 'ENOENT') throw apiError(400, 'Choose an existing content type.');
    throw error;
  }
  if (!isWithin(contentRoot, resolvedParent)) throw apiError(400, 'Symlinked folders outside content/ are not allowed.');
  return { normalized, candidate };
}

async function collectMarkdownFiles(contentRoot, directory = contentRoot, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(contentRoot, absolute, relative));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push({
        path: relative,
        type: relative.split('/')[0],
        slug: path.posix.basename(relative, '.md')
      });
    }
  }
  return files;
}

async function listContentTypes(contentRoot) {
  const entries = await readdir(contentRoot, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw apiError(413, 'Markdown file is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw apiError(400, 'Request body must be valid JSON.');
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

async function atomicWrite(target, content) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export function createContentApi({ root = process.cwd() } = {}) {
  const contentRoot = path.resolve(root, 'content');
  return async function contentApi(req, res, next = () => {}) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!url.pathname.startsWith(API_ROOT)) return next();
    try {
      await access(contentRoot, constants.R_OK | constants.W_OK);
      if (req.method === 'GET' && url.pathname === `${API_ROOT}/files`) {
        const [files, types] = await Promise.all([collectMarkdownFiles(contentRoot), listContentTypes(contentRoot)]);
        return sendJson(res, 200, { files, types });
      }
      if (req.method === 'GET' && url.pathname === `${API_ROOT}/file`) {
        const { normalized, candidate } = await validateExistingPath(contentRoot, url.searchParams.get('path'));
        const content = await readFile(candidate, 'utf8');
        return sendJson(res, 200, { path: normalized, content, version: contentHash(content) });
      }
      if (req.method === 'POST' && url.pathname === `${API_ROOT}/files`) {
        const payload = await readRequestBody(req);
        if (typeof payload.content !== 'string') throw apiError(400, 'Markdown content must be a string.');
        const { normalized, candidate } = await validateNewPath(contentRoot, payload.path);
        try {
          await writeFile(candidate, payload.content, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
        } catch (error) {
          if (error.code === 'EEXIST') throw apiError(409, 'A post with this path already exists.');
          throw error;
        }
        return sendJson(res, 201, { path: normalized, content: payload.content, version: contentHash(payload.content) });
      }
      if (req.method === 'PUT' && url.pathname === `${API_ROOT}/file`) {
        const payload = await readRequestBody(req);
        if (typeof payload.content !== 'string' || typeof payload.version !== 'string') {
          throw apiError(400, 'Content and its current version are required.');
        }
        const { normalized, candidate } = await validateExistingPath(contentRoot, payload.path);
        const current = await readFile(candidate, 'utf8');
        const currentVersion = contentHash(current);
        if (currentVersion !== payload.version) {
          throw apiError(409, 'This file changed on disk after it was opened.', { version: currentVersion });
        }
        await atomicWrite(candidate, payload.content);
        return sendJson(res, 200, { path: normalized, version: contentHash(payload.content) });
      }
      throw apiError(404, 'Editor endpoint not found.');
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status === 500) console.error(error);
      sendJson(res, status, { error: error.message || 'Unexpected editor error.', details: error.details });
    }
  };
}

export function localEditorPlugin(options = {}) {
  return {
    name: 'local-markdown-editor-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(createContentApi(options));
    }
  };
}
