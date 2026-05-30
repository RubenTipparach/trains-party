import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Fully static build for GitHub Pages. `404.html` is the SPA fallback that
    // boots the client for dynamic routes such as /room/<CODE>.
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: '404.html',
      precompress: false,
      strict: true
    }),
    // Project Pages serve from /<repo>/. CI sets BASE_PATH; empty for local dev.
    paths: {
      base: process.env.BASE_PATH ?? ''
    }
  }
};

export default config;
