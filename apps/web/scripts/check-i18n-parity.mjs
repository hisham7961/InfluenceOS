#!/usr/bin/env node
// Translation-key parity check (Arabic Localization pass, spec §9/§137).
// Fails loudly if messages/en/*.json and messages/ar/*.json don't have
// identical key structures — no silent fallback for a forgotten key.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const messagesRoot = path.join(here, '..', 'messages');

function loadNamespace(locale, file) {
  const raw = readFileSync(path.join(messagesRoot, locale, file), 'utf8');
  return JSON.parse(raw);
}

function flatten(obj, prefix = '') {
  const keys = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const nested of flatten(v, p)) keys.add(nested);
    } else {
      keys.add(p);
    }
  }
  return keys;
}

function namespaceFiles(locale) {
  return readdirSync(path.join(messagesRoot, locale))
    .filter((f) => f.endsWith('.json'))
    .sort();
}

const enFiles = namespaceFiles('en');
const arFiles = namespaceFiles('ar');

let failed = false;

const enFileSet = new Set(enFiles);
const arFileSet = new Set(arFiles);
for (const f of enFiles) {
  if (!arFileSet.has(f)) {
    console.error(`✗ Namespace file messages/en/${f} has no matching messages/ar/${f}`);
    failed = true;
  }
}
for (const f of arFiles) {
  if (!enFileSet.has(f)) {
    console.error(`✗ Namespace file messages/ar/${f} has no matching messages/en/${f}`);
    failed = true;
  }
}

const sharedFiles = enFiles.filter((f) => arFileSet.has(f));
let totalKeys = 0;

for (const file of sharedFiles) {
  const namespace = file.replace(/\.json$/, '');
  const en = flatten(loadNamespace('en', file));
  const ar = flatten(loadNamespace('ar', file));
  totalKeys += en.size;

  const missingInAr = [...en].filter((k) => !ar.has(k));
  const missingInEn = [...ar].filter((k) => !en.has(k));

  for (const k of missingInAr) {
    console.error(`✗ [${namespace}] key "${k}" exists in en.json but not ar.json`);
    failed = true;
  }
  for (const k of missingInEn) {
    console.error(`✗ [${namespace}] key "${k}" exists in ar.json but not en.json`);
    failed = true;
  }
}

if (failed) {
  console.error('\nTranslation parity check FAILED — see mismatches above.');
  process.exit(1);
}

console.log(`✓ Translation parity OK — ${sharedFiles.length} namespaces, ${totalKeys} keys, en/ar fully synchronized.`);
