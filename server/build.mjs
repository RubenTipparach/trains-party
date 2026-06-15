/**
 * Bundle the server with esbuild. The shared engine lives in frontend/src/lib and
 * imports itself via the `$lib` alias (e.g. registry.ts -> `$lib/data/g1889`). We
 * map `$lib` to an ABSOLUTE path here so resolution does not depend on a tsconfig
 * sitting next to the engine files (the Docker image only copies frontend/src/lib,
 * not the frontend tsconfig) nor on each importer's depth. Real npm deps stay
 * external and load from node_modules at runtime.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const lib = resolve(here, '../frontend/src/lib');

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/index.js',
  sourcemap: true,
  external: ['better-sqlite3', 'fastify', '@fastify/cors', '@fastify/cookie'],
  alias: { $lib: lib },
  logLevel: 'info'
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
