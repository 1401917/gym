import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();

function walkFiles(directory, matcher, collected = []) {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'artifacts' || entry === 'www') {
      continue;
    }

    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walkFiles(fullPath, matcher, collected);
      continue;
    }

    if (matcher(fullPath)) {
      collected.push(fullPath);
    }
  }

  return collected;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function isRelativeBrowserSpecifier(specifier) {
  return specifier.startsWith('.')
    || specifier.startsWith('/')
    || /^[a-z]+:/i.test(specifier);
}

function getNonRelativeImportSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /(?:import|export)\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /import\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!isRelativeBrowserSpecifier(specifier)) {
        specifiers.add(specifier);
      }
    }
  }

  return [...specifiers];
}

JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));

const syntaxTargets = [
  join(projectRoot, 'sync-web.mjs'),
  ...walkFiles(join(projectRoot, 'scripts'), (filePath) => filePath.endsWith('.js') || filePath.endsWith('.mjs')),
  ...walkFiles(join(projectRoot, 'src'), (filePath) => filePath.endsWith('.js') || filePath.endsWith('.mjs')),
  ...walkFiles(join(projectRoot, 'tests'), (filePath) => filePath.endsWith('.mjs')),
];
const browserScriptTargets = walkFiles(join(projectRoot, 'scripts'), (filePath) => filePath.endsWith('.js'));

for (const filePath of syntaxTargets) {
  runCommand(process.execPath, ['--check', filePath]);
}

for (const filePath of browserScriptTargets) {
  const source = readFileSync(filePath, 'utf8');
  const nonRelativeSpecifiers = getNonRelativeImportSpecifiers(source);
  if (nonRelativeSpecifiers.length) {
    throw new Error(`Browser script ${filePath} uses non-relative imports: ${nonRelativeSpecifiers.join(', ')}`);
  }
}

runCommand(process.execPath, ['--test', 'tests/*.test.mjs']);
runCommand(process.execPath, ['--input-type=module', '-e', "await import('./scripts/access.js'); await import('./scripts/database.js'); await import('./scripts/food-photo-ai.js'); await import('./scripts/payments.js'); await import('./scripts/reminders.js'); await import('./scripts/storage.js'); await import('./scripts/subscription-config.js'); console.log('validate-app import smoke ok');"]);
