#!/usr/bin/env node
/**
 * Server-generated text in the user's language (P2.5).
 *
 * The API and worker write their messages in English: error messages
 * (AppError / errBody), notification titles and bodies, and activity-feed
 * lines. The web shows them in Arabic by matching each one against the
 * English templates in messages/en/serverText.json and rendering the Arabic
 * entry with the same key (see src/lib/server-text.ts).
 *
 * This script reads the server source with the TypeScript parser and lists
 * every such message. Run it with no arguments to CHECK that every one is in
 * the catalog (CI runs this with the translation parity check), or with
 * --missing to print the ones that aren't, as catalog-ready JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const ROOTS = ['packages/domain/src', 'apps/worker/src', 'apps/api/src'].map((p) => path.join(repo, p));
const CATALOG = path.join(here, '../messages/en/serverText.json');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'scripts') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** A readable placeholder name for an interpolated expression. */
function placeholderName(expr, sf) {
  let e = expr;
  while (ts.isCallExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) {
    if (ts.isCallExpression(e)) {
      // x.toFixed(3) → x ; String(y) → y ; Math.round(z / …) → z
      if (ts.isPropertyAccessExpression(e.expression) && ['toFixed', 'toLowerCase', 'toUpperCase', 'replace', 'join', 'slice', 'toISOString', 'trim'].includes(e.expression.name.text)) {
        e = e.expression.expression;
      } else if (e.arguments.length) {
        e = e.arguments[0];
      } else {
        e = e.expression;
      }
    } else {
      e = e.expression;
    }
  }
  if (ts.isBinaryExpression(e)) e = e.left;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isElementAccessExpression(e)) return placeholderName(e.expression, sf);
  return 'value';
}

/** The English text (with {placeholders}) of a message expression, or null when it isn't literal. */
function templateOf(node, sf) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return templateOf(node.expression, sf);
  if (ts.isTemplateExpression(node)) {
    const used = new Map();
    let out = node.head.text;
    for (const span of node.templateSpans) {
      let name = placeholderName(span.expression, sf);
      const n = (used.get(name) ?? 0) + 1;
      used.set(name, n);
      if (n > 1) name = `${name}${n}`;
      out += `{${name}}` + span.literal.text;
    }
    return out;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = templateOf(node.left, sf);
    const r = templateOf(node.right, sf);
    if (l !== null && r !== null) return l + r;
    if (l !== null) return l + '{value}';
    if (r !== null) return '{value}' + r;
  }
  return null;
}

function objectProp(obj, name) {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === name) return p.initializer;
  }
  return undefined;
}

const ERROR_METHODS = new Set(['conflict', 'badRequest', 'validation', 'forbidden', 'unauthorized']);

export function extract() {
  const found = [];
  const dynamic = [];
  for (const file of ROOTS.flatMap((r) => walk(r))) {
    const text = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = path.relative(repo, file);
    // `cond ? 'a' : 'b'`, `x ?? 'b'` and `\`…\`.slice(0, n)` each hold messages too.
    const expand = (arg) => {
      if (!arg) return [];
      if (ts.isParenthesizedExpression(arg)) return expand(arg.expression);
      if (ts.isConditionalExpression(arg)) return [...expand(arg.whenTrue), ...expand(arg.whenFalse)];
      if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        return [...expand(arg.left), ...expand(arg.right)];
      }
      if (ts.isCallExpression(arg) && ts.isPropertyAccessExpression(arg.expression) && ['slice', 'trim'].includes(arg.expression.name.text)) {
        return expand(arg.expression.expression);
      }
      return [arg];
    };
    const add = (kind, node, arg) => {
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      for (const part of expand(arg)) {
        if (ts.isNullKeyword?.(part) || part.kind === ts.SyntaxKind.NullKeyword) continue;
        const t = templateOf(part, sf);
        if (t === null) {
          dynamic.push({ kind, where: `${rel}:${line}`, expr: part.getText(sf).slice(0, 80) });
          continue;
        }
        if (t.trim()) found.push({ kind, text: t, where: `${rel}:${line}` });
      }
    };
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'AppError') {
          const m = callee.name.text;
          if (ERROR_METHODS.has(m)) {
            if (node.arguments[0]) add('error', node, node.arguments[0]);
          } else if (m === 'notFound') {
            const what = node.arguments[0] ? templateOf(node.arguments[0], sf) : 'Resource';
            if (what !== null) found.push({ kind: 'error', text: `${what} not found.`, where: `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}` });
          }
        }
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
        if (name === 'errBody' && node.arguments[1]) add('error', node, node.arguments[1]);
        if (name === 'createNotification' || name === 'alertAdmins') {
          const obj = node.arguments[1];
          add('notification', node, objectProp(obj, 'title'));
          if (objectProp(obj, 'body')) add('notification', node, objectProp(obj, 'body'));
        }
        if (name === 'logActivity') add('activity', node, objectProp(node.arguments[1], 'message'));
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'AppError' && node.arguments?.[1]) {
        add('error', node, node.arguments[1]);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { found, dynamic };
}

/** Placeholders don't need the same names — only the fixed text has to match. */
export const canonical = (s) => s.replace(/\{[^}]*\}/g, '{}').replace(/\s+/g, ' ').trim();

function main() {
  const { found, dynamic } = extract();
  const catalog = fs.existsSync(CATALOG) ? JSON.parse(fs.readFileSync(CATALOG, 'utf8')) : {};
  const known = new Set(Object.values(catalog).map(canonical));
  const missing = new Map();
  for (const f of found) {
    const c = canonical(f.text);
    if (!known.has(c) && !missing.has(c)) missing.set(c, f);
  }
  if (process.argv.includes('--missing')) {
    const out = {};
    let i = 0;
    for (const f of missing.values()) out[`${f.kind}:${f.where}#${++i}`] = f.text;
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  if (process.argv.includes('--dynamic')) {
    for (const d of dynamic) console.log(`${d.kind}\t${d.where}\t${d.expr}`);
    return;
  }
  const unique = new Set(found.map((f) => canonical(f.text))).size;
  if (missing.size) {
    console.error(`✗ ${missing.size} of ${unique} server messages have no entry in messages/en/serverText.json (so they stay English in Arabic):`);
    for (const f of missing.values()) console.error(`  - [${f.kind}] ${f.where}: ${f.text}`);
    console.error('Add them (en + ar). `node scripts/server-text.mjs --missing` prints them as JSON.');
    process.exit(1);
  }
  console.log(`✓ Server text covered — ${unique} messages (errors, notifications, activity) all have en/ar catalog entries.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
