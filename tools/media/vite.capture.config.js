import { defineConfig } from 'vite';

// The dev server the capture scripts use: no file watching and no hot
// reload, so editing anything while a render runs cannot reload the page out
// from under it.
export default defineConfig({
  root: new URL('../..', import.meta.url).pathname,
  base: './',
  server: { hmr: false, watch: null, port: 5174, strictPort: true, host: '127.0.0.1' },
});
