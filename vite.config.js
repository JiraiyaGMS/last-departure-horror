import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs: GitHub Pages serves this repo from a subpath
  // (/last-departure-horror/), where absolute /assets/... URLs 404.
  base: './',
});
