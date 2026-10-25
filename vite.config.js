import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // Shown on the title screen, so a bug report says which build it was.
  define: { __VERSION__: JSON.stringify(version) },
  // Relative asset URLs: GitHub Pages serves this repo from a subpath
  // (/last-departure-horror/), where absolute /assets/... URLs 404.
  base: './',
});
