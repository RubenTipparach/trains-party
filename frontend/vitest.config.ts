import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Engine tests are pure TS (no Svelte/DOM), so we avoid the SvelteKit plugin and
// just resolve the $lib alias to src/lib.
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
