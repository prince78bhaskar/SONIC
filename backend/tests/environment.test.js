import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:js|jsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

function templateKeys(text) {
  return new Set(text.split(/\r?\n/).map((line) => line.match(/^\s*([A-Z][A-Z0-9_]*)=/)?.[1]).filter(Boolean));
}

test('environment templates document every backend and frontend setting', async () => {
  const backendFiles = await sourceFiles(join(projectRoot, 'backend', 'src'));
  const frontendFiles = await sourceFiles(join(projectRoot, 'frontend', 'src'));
  const backendSource = (await Promise.all(backendFiles.map((path) => readFile(path, 'utf8')))).join('\n');
  const frontendSource = (await Promise.all(frontendFiles.map((path) => readFile(path, 'utf8')))).join('\n');
  const backendReferences = new Set([...backendSource.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]));
  const frontendReferences = new Set([...frontendSource.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]));
  backendReferences.delete('NODE_ENV');
  const backendTemplate = templateKeys(await readFile(join(projectRoot, 'backend', '.env.example'), 'utf8'));
  const frontendTemplate = templateKeys(await readFile(join(projectRoot, 'frontend', '.env.example'), 'utf8'));

  assert.deepEqual([...backendReferences].filter((key) => !backendTemplate.has(key)), [], 'backend/.env.example covers all backend variables');
  assert.deepEqual([...frontendReferences].filter((key) => !frontendTemplate.has(key)), [], 'frontend/.env.example covers all frontend variables');
});
