import { defineConfig } from 'vite';
import { localEditorPlugin } from './tools/editor/content-api.mjs';

export default defineConfig({
  plugins: [localEditorPlugin()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  }
});
