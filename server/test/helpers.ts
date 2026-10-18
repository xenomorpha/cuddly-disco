import { PGlite } from '@electric-sql/pglite';
import { pgliteDb, type Db } from '../src/db';
import { migrate } from '../src/migrate';

/** A fresh in-process Postgres with the schema applied. */
export async function freshDb(): Promise<Db> {
  const db = pgliteDb(new PGlite() as any);
  await migrate(db);
  return db;
}
