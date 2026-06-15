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
    },
    // Deploy-version detection: poll the deployed build id; when it changes the
    // `updated` store flips true and the app reloads (preserving the room URL),
    // so players always pick up a new deploy. Mirrors the High Frontier reload.
    version: {
      name: process.env.BUILD_SHA ?? 'dev',
      pollInterval: 60_000
    }
  }
};

export default config;
