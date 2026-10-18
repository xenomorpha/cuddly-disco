import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ru from './locales/ru.json';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith('.test.ts') ? [p] : [];
  });
}

describe('i18n', () => {
  it('every t() string has a Russian translation', () => {
    const missing = new Set<string>();
    for (const f of files(join(__dirname))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        const key = m[1].replace(/\\'/g, "'");
        if (!(key in ru)) missing.add(key);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
