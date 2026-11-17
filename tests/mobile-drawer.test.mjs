import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod,
    exports: mod.exports,
    require: (name) => { throw new Error(`Unexpected import ${name}`); },
  });
  return mod.exports;
}

const { cycleDrawerFocusIndex } = load('src/lib/mobileDrawerFocus.ts');
const shell = fs.readFileSync(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

const PAGES = [
  ['/home', 'Home'],
  ['/dashboard', 'Dashboard'],
  ['/logs', 'Farm Logs'],
  ['/schedule', 'Schedule & Events'],
  ['/ventilation', 'Ventilation'],
  ['/analytics', 'Analytics'],
  ['/assistant', 'Flock Vet'],
  ['/egg-counting', 'Egg Counting'],
  ['/admin', 'Admin'],
];

test('tab wraps inside the drawer and pulls focus back from the page behind it', () => {
  assert.equal(cycleDrawerFocusIndex(4, 3, false, false), 0);
  assert.equal(cycleDrawerFocusIndex(4, 0, true, false), 3);
  assert.equal(cycleDrawerFocusIndex(4, 1, false, false), null);
  assert.equal(cycleDrawerFocusIndex(4, 2, true, false), null);
  assert.equal(cycleDrawerFocusIndex(4, -1, false, true), 0);
  assert.equal(cycleDrawerFocusIndex(4, -1, true, true), 3);
  assert.equal(cycleDrawerFocusIndex(4, -1, false, false), null);
  assert.equal(cycleDrawerFocusIndex(1, 0, false, false), 0);
  assert.equal(cycleDrawerFocusIndex(1, 0, true, false), 0);
  assert.equal(cycleDrawerFocusIndex(0, 0, false, true), null);
  assert.equal(cycleDrawerFocusIndex(3, 9, false, false), null);
});

test('the bottom bar and the space it reserved are gone', () => {
  assert.doesNotMatch(shell, /sa-mobile-nav|sa-mobile-link|Mobile bottom nav/);
  assert.doesNotMatch(css, /sa-mobile-nav|sa-mobile-link/);
  assert.doesNotMatch(css, /padding-bottom:\s*58px/);
});

test('the sidebar lists every former bottom-bar page, including Ventilation', () => {
  const navBlock = shell.slice(shell.indexOf('const NAV'), shell.indexOf('function isActive'));
  for (const [href, label] of PAGES) {
    assert.match(navBlock, new RegExp(`href:\\s*"${href}"`));
    assert.match(navBlock, new RegExp(`label:\\s*"${label}"`));
  }
  assert.match(shell, /const navItems = isSuper \? \[\.\.\.NAV, ADMIN_ITEM\] : NAV/);
  assert.equal((shell.match(/navItems\.map/g) ?? []).length, 1);
  assert.match(shell, /<nav className="sa-side-nav">[\s\S]*navItems\.map/);
});

test('the drawer closes on navigation, overlay tap, and Escape, and keeps a name', () => {
  assert.match(shell, /onClick=\{\(\) => setOpen\(false\)\}/);
  assert.match(shell, /sa-drawer-backdrop[\s\S]*onClick=\{\(\) => setOpen\(false\)\}/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /aria-label=\{menuLabel\}/);
  assert.match(shell, /aria-label=\{drawerOpen \? "Main menu" : undefined\}/);
  assert.match(shell, /cycleDrawerFocusIndex/);
  assert.match(shell, /menuBtnRef/);
  assert.match(shell, /if \(pathSeen !== pathname\)/);
  assert.match(shell, /setPathSeen\(pathname\);\s*setOpen\(false\)/);
});

test('the menu button stays visible at the breakpoint where the bottom bar used to show', () => {
  assert.match(css, /\.sa-menu-btn \{ display: inline-flex;/);
  assert.doesNotMatch(css, /\.sa-menu-btn\s*\{[^}]*display:\s*none/);
  const mobileBlocks = css.match(/@media \(max-width: 900px\) \{[\s\S]*?\n\}/g) ?? [];
  assert.ok(mobileBlocks.some((block) => /\.sa-menu-btn\s*\{[^}]*display:\s*inline-flex/.test(block)));
  const desktop = css.match(/@media \(min-width: 901px\) \{[\s\S]*?\n\}/);
  assert.ok(desktop);
  assert.doesNotMatch(desktop[0], /sa-menu-btn|sa-mobile|padding-bottom/);
  assert.match(desktop[0], /\.sa-shell\.collapsed \.sa-sidebar \{ display: none; \}/);
});
