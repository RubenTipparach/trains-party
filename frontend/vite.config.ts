import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // Ship sourcemaps so production stack traces point at real files/lines while
  // the game is in active development (helps diagnose runtime errors that only
  // reproduce in the browser, e.g. Svelte reconciliation edge cases).
  build: { sourcemap: true },
  define: {
    // Build version (short SHA) so clients can detect new deploys. CI sets BUILD_SHA.
    __BUILD_SHA__: JSON.stringify(process.env.BUILD_SHA ?? 'dev')
  }
});
