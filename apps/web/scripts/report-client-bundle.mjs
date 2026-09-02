import { brotliCompressSync, gzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const buildDir = resolve(scriptDir, '..', '.next');
const serverAppDir = resolve(buildDir, 'server', 'app');
const requestedRoutes = process.argv.slice(2);

if (!existsSync(serverAppDir)) {
  console.error('No production build found. Run `pnpm build` first.');
  process.exit(1);
}

function findManifests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findManifests(path);
    return entry.name.endsWith('client-reference-manifest.js') ? [path] : [];
  });
}

function readManifest(path) {
  const source = readFileSync(path, 'utf8');
  const routeMatch = source.match(/__RSC_MANIFEST\[(".*?")\]/);
  const jsonStart = source.indexOf('= {', routeMatch?.index ?? 0);

  if (!routeMatch || jsonStart === -1) {
    throw new Error(`Could not parse ${path}`);
  }

  return {
    routeKey: JSON.parse(routeMatch[1]),
    manifest: JSON.parse(
      source
        .slice(jsonStart + 2)
        .trim()
        .replace(/;$/, ''),
    ),
  };
}

function publicRoute(routeKey) {
  const route = routeKey.replace(/\/page$/, '');
  return route || '/';
}

function bytesFor(chunks, compress) {
  return chunks.reduce((total, chunk) => {
    const source = readFileSync(resolve(buildDir, chunk));
    return total + (compress ? compress(source).byteLength : source.byteLength);
  }, 0);
}

const rows = findManifests(serverAppDir)
  .map(readManifest)
  .map(({ routeKey, manifest }) => {
    const entrySuffix = `/apps/web/src/app${routeKey}`;
    const entry = Object.entries(manifest.entryJSFiles).find(([key]) => key.endsWith(entrySuffix));
    if (!entry) return null;

    const chunks = [...new Set(entry[1])];
    return {
      route: publicRoute(routeKey),
      chunks: chunks.length,
      raw: bytesFor(chunks),
      gzip: bytesFor(chunks, gzipSync),
      brotli: bytesFor(chunks, brotliCompressSync),
    };
  })
  .filter(Boolean)
  .filter(({ route }) => requestedRoutes.length === 0 || requestedRoutes.includes(route))
  .sort((a, b) => a.route.localeCompare(b.route));

if (requestedRoutes.some((route) => !rows.some((row) => row.route === route))) {
  const missing = requestedRoutes.filter((route) => !rows.some((row) => row.route === route));
  console.error(`Unknown route(s): ${missing.join(', ')}`);
  process.exit(1);
}

const formatKiB = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

console.table(
  rows.map(({ route, chunks, raw, gzip, brotli }) => ({
    route,
    chunks,
    raw: formatKiB(raw),
    gzip: formatKiB(gzip),
    brotli: formatKiB(brotli),
  })),
);
