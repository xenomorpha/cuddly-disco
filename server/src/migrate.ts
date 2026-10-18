import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './db';

const SQL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql');

/** Applies sql/NNN_*.sql files that have not run yet, each in its own transaction. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(SQL_DIR)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(path.join(SQL_DIR, f), 'utf8');
    await db.tx(async (q) => {
      await q.exec(sql);
      await q.query('insert into schema_migrations (name) values ($1)', [f]);
    });
    applied.push(f);
  }
  return applied;
}
