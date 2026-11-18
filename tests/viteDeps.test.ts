import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * vite.config.ts lists every run-time library in `optimizeDeps.include`. A library the dev server only finds later makes it re-bundle while
 * the app is open, and every file the window already loaded answers 504 ("Importing a module script failed"): the desktop app then shows
 * "Your notes couldn't be opened". So every library the app imports at run time must be listed (type-only imports and asset imports are not).
 */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !n.endsWith('.d.ts') ? [p] : [];
  });

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> };
const runtime = new Set(Object.keys(pkg.dependencies ?? {}));
const owner = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

function runtimeImports(): Map<string, string> {
  const found = new Map<string, string>();
  for (const f of walk('src')) {
    const text = readFileSync(f, 'utf8');
    // `import x from 'a'`, `import 'a'`, `export … from 'a'`, `import('a')`; not `import type …`
    const re = /(?:^|[\s;])(?:import\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?|export\s+(?!type\b)[^'"]*?\sfrom\s+|import\()\s*['"]([^'"]+)['"]/gm;
    for (const m of text.matchAll(re)) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('/') || spec.includes('?')) continue; // our own files, and assets such as `…?url`
      if (spec.endsWith('.css') || spec.startsWith('@fontsource')) continue; // style sheets and fonts are not bundled by the dependency optimizer
      if (runtime.has(owner(spec))) found.set(spec, f);
    }
  }
  return found;
}

function included(): Set<string> {
  const config = readFileSync('vite.config.ts', 'utf8');
  const body = config.split('include: [')[1].split(']')[0];
  return new Set([...body.matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

describe('the dev server pre-bundles every run-time library', () => {
  it('lists each library the app imports at run time in optimizeDeps.include', () => {
    const inc = included();
    const missing = [...runtimeImports()].filter(([spec]) => !inc.has(spec)).map(([spec, file]) => `${spec} (from ${file})`);
    expect(missing).toEqual([]);
  });
  it('finds the imports it is meant to check (so the test cannot pass by finding nothing)', () => {
    const all = runtimeImports();
    expect(all.has('zustand')).toBe(true);
    expect(all.has('react')).toBe(true);
    expect(all.size).toBeGreaterThan(10);
  });
});
