#!/usr/bin/env node
/*
 * Preflight checks for a full sweep (§4). Run BEFORE pushing.
 *
 * These are the checks that were previously retyped by hand every version, which
 * is how they drift and get skipped. Three of them catch failures this project
 * has actually shipped:
 *   - version skew: a sed that silently missed build.js deployed vN+1 displaying vN
 *   - route parity: a nav key with no page=== branch is a dead menu item
 *   - duplicate definitions: two `var x=function` in ONE scope, where the later
 *     silently wins (the smaSeries incident). Uses babel scope analysis, NOT grep —
 *     a grep-based version reported 16 collisions of which 0 were real, because it
 *     could not see IIFE boundaries.
 */
const fs = require('fs');
const path = require('path');
// Fail with an instruction, not a stack trace. A brand-new environment clones the repo and runs
// the §4 checks BEFORE `npm install` — node_modules is not committed — and a raw
// "Cannot find module '@babel/parser'" reads like the repo is broken rather than like a missing
// step. Verified by cold-cloning to a fresh directory.
let parser, traverse;
try {
  parser = require('@babel/parser');
  traverse = require('@babel/traverse').default;
} catch (e) {
  console.error('\n  preflight needs dependencies. Run:  npm install\n' +
                '  (node_modules is not committed; the handoff gap check works without it)\n');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
let failures = 0, warnings = 0;
const ok = m => console.log('  \x1b[32mPASS\x1b[0m ' + m);
const bad = m => { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); };
const warn = m => { warnings++; console.log('  \x1b[33mWARN\x1b[0m ' + m); };

// ── 1. version consistency ────────────────────────────────────────────────────
console.log('\nversion consistency');
const appFiles = fs.readdirSync(root).filter(f => /^app_v\d+\.jsx$/.test(f));
if (appFiles.length !== 1) bad(`expected exactly one app_vN.jsx, found ${appFiles.length}: ${appFiles.join(', ')}`);
const appV = appFiles.length ? +appFiles[0].match(/\d+/)[0] : null;
const buildSrc = fs.readFileSync(path.join(root, 'build.js'), 'utf8');
const bannerV = (buildSrc.match(/BUILD_TS="v(\d+)/) || [])[1];
const pkgV = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const pkgNum = pkgV ? +pkgV.split('.').join('') : null;
if (appV && bannerV && +bannerV === appV) ok(`app_v${appV}.jsx matches build.js banner v${bannerV}`);
else bad(`app_v${appV}.jsx vs build.js banner v${bannerV} — the banner is hardcoded; a missed sed deploys vN+1 displaying vN`);
if (pkgNum === appV) ok(`package.json ${pkgV} matches v${appV}`);
else warn(`package.json ${pkgV} does not map to v${appV} (cosmetic, but keep them in step)`);

// ── parse once for the checks below ───────────────────────────────────────────
const src = fs.readFileSync(path.join(root, appFiles[0]), 'utf8');
const ast = parser.parse(src, { sourceType: 'script', plugins: ['jsx'], errorRecovery: true });

// ── 2. route / menu parity ────────────────────────────────────────────────────
// Stated as an INVARIANT, not a count: counts drift every time a page is added,
// and a stale expected number makes a future session think something broke.
console.log('\nroute / menu parity');
const menuLine = src.split('\n').find(l => l.includes('var menuItems=['));
const items = menuLine ? [...menuLine.matchAll(/\{key:'([^']+)'(.*?)\}/g)] : [];
const nav = items.filter(m => !/type:'(header|divider)'/.test(m[2]) && m[1] !== 'logout').map(m => m[1]);
const routes = new Set([...src.matchAll(/page===?'([^']+)'/g)].map(m => m[1]));
const missing = nav.filter(k => !routes.has(k));
const EXPECTED_ORPHANS = ['cheatsheet', 'glanceapi'];
const orphans = [...routes].filter(r => !nav.includes(r)).sort();
const unexpected = orphans.filter(o => !EXPECTED_ORPHANS.includes(o));
if (!missing.length) ok(`${nav.length} nav items, all routed`);
else bad(`nav keys with no page=== branch: ${missing.join(', ')}`);
if (!unexpected.length) ok(`orphan routes exactly the intentional ${EXPECTED_ORPHANS.join(' + ')}`);
else bad(`unexpected orphan routes: ${unexpected.join(', ')}`);

// ── 3. duplicate definitions in the SAME scope ────────────────────────────────
console.log('\nduplicate definitions (scope-aware)');
const dups = [];
// Deterministic: count function-valued `var` declarators per RESOLVED scope.
// An earlier draft used babel's constantViolations, which reported 15 phantom
// collisions on a clean file (same line listed twice) — a check that cries wolf
// gets ignored (§5.6), so it was replaced rather than tuned.
const perScope = new Map();
traverse(ast, {
  VariableDeclarator(p2) {
    const init = p2.node.init;
    if (!init || !/FunctionExpression|ArrowFunctionExpression/.test(init.type)) return;
    if (p2.node.id.type !== 'Identifier') return;
    // `var` is function-scoped; let/const are block-scoped. Resolve accordingly so a
    // helper redefined in two sibling IIFEs is NOT flagged, but two in one function is.
    const kind = p2.parent.kind;
    const scope = kind === 'var' ? p2.scope.getFunctionParent() || p2.scope.getProgramParent() : p2.scope;
    const key = scope.uid + '::' + p2.node.id.name;
    if (!perScope.has(key)) perScope.set(key, { name: p2.node.id.name, lines: [] });
    perScope.get(key).lines.push(p2.node.loc ? p2.node.loc.start.line : 0);
  }
});
for (const v of perScope.values()) if (v.lines.length > 1) dups.push(v);

if (!dups.length) ok('no function-valued binding redefined within one scope');
else dups.forEach(d => bad(`${d.name} redefined in the same scope at lines ${d.lines.join(', ')} — the later definition silently wins`));

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${failures ? '\x1b[31m' : '\x1b[32m'}preflight: ${failures} failure(s), ${warnings} warning(s)\x1b[0m\n`);
process.exit(failures ? 1 : 0);
