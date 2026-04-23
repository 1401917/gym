import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(rootDir, 'www');
const entriesToSync = [
  'capacitor.js',
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'assets',
  'legal',
  'styles',
  'scripts',
];

mkdirSync(webDir, { recursive: true });

for (const entry of entriesToSync) {
  const source = join(rootDir, entry);
  const destination = join(webDir, entry);

  if (!existsSync(source)) {
    continue;
  }

  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
}

console.log(`Synced ${entriesToSync.length} web entries to ${webDir}`);
