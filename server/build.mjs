/**
 * Bundle the server with esbuild. The shared engine lives in frontend/src/lib and
 * imports itself via the `$lib` alias (e.g. registry.ts -> `$lib/data/g1889`).
 *
 * We resolve `$lib/*` with an explicit plugin that maps to the real file under an
 * ABSOLUTE engine path and probes the extension itself. This avoids depending on
 * esbuild's alias resolution (which proved version-sensitive) or on a tsconfig
 * sitting next to the engine files (the Docker image only copies frontend/src/lib).
 * Real npm deps stay external and load from node_modules at runtime.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const lib = resolve(here, '../frontend/src/lib');

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

function resolveLib(rel) {
  const b = resolve(lib, rel);
  // File candidates BEFORE the bare path: `$lib/engine` is a directory (use its
  // index), while `$lib/data/g1889` is a file (g1889.ts).
  for (const c of [`${b}.ts`, `${b}.js`, join(b, 'index.ts'), join(b, 'index.js'), b]) {
    if (isFile(c)) return c;
  }
  return `${b}.ts`; // let esbuild report a clear error if it truly is missing
}

const libResolver = {
  name: 'lib-resolver',
  setup(b) {
    b.onResolve({ filter: /^\$lib\// }, (args) => ({ path: resolveLib(args.path.slice('$lib/'.length)) }));
  }
};

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/index.js',
  sourcemap: true,
  external: ['better-sqlite3', 'fastify', '@fastify/cors', '@fastify/cookie', '@fastify/websocket'],
  plugins: [libResolver],
  logLevel: 'info'
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
