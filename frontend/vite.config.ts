import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    // Build version (short SHA) so clients can detect new deploys. CI sets BUILD_SHA.
    __BUILD_SHA__: JSON.stringify(process.env.BUILD_SHA ?? 'dev')
  }
});
