import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentHash, createContentApi, normalizeMarkdownPath } from '../tools/editor/content-api.mjs';

let root;
let server;
let baseUrl;

async function request(endpoint, options) {
  const response = await fetch(`${baseUrl}${endpoint}`, options);
  return { response, payload: await response.json() };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'markdown-editor-test-'));
  await mkdir(path.join(root, 'content', 'projects'), { recursive: true });
  await writeFile(path.join(root, 'content', 'projects', 'existing.md'), '# Existing\n', 'utf8');
  server = createServer(createContentApi({ root }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

describe('content editor API', () => {
  it('lists and loads Markdown files with a version hash', async () => {
    const list = await request('/__editor/api/files');
    expect(list.response.status).toBe(200);
    expect(list.payload).toEqual({
      files: [{ path: 'projects/existing.md', type: 'projects', slug: 'existing' }],
      types: ['projects']
    });

    const loaded = await request('/__editor/api/file?path=projects%2Fexisting.md');
    expect(loaded.payload.content).toBe('# Existing\n');
    expect(loaded.payload.version).toBe(contentHash('# Existing\n'));
  });

  it('creates a new post without overwriting an existing one', async () => {
    const created = await request('/__editor/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'projects/new-post.md', content: '# New\n' })
    });
    expect(created.response.status).toBe(201);
    expect(await readFile(path.join(root, 'content', 'projects', 'new-post.md'), 'utf8')).toBe('# New\n');

    const duplicate = await request('/__editor/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'projects/new-post.md', content: 'replacement' })
    });
    expect(duplicate.response.status).toBe(409);
  });

  it('saves atomically and rejects a stale version', async () => {
    const loaded = await request('/__editor/api/file?path=projects%2Fexisting.md');
    const saved = await request('/__editor/api/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'projects/existing.md', version: loaded.payload.version, content: '# Updated\n' })
    });
    expect(saved.response.status).toBe(200);
    expect(await readFile(path.join(root, 'content', 'projects', 'existing.md'), 'utf8')).toBe('# Updated\n');

    const stale = await request('/__editor/api/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'projects/existing.md', version: loaded.payload.version, content: '# Lost\n' })
    });
    expect(stale.response.status).toBe(409);
    expect(await readFile(path.join(root, 'content', 'projects', 'existing.md'), 'utf8')).toBe('# Updated\n');
  });

  it.each(['../outside.md', '/absolute.md', 'projects/../outside.md', 'projects/file.txt', 'single.md'])('rejects unsafe path %s', value => {
    expect(() => normalizeMarkdownPath(value)).toThrow();
  });
});
