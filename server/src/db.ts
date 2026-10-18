// Thin database interface so the same queries run on node-postgres (server)
// and PGlite (in-process Postgres used by the unit tests).

import pg from 'pg';

export interface Queryable {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs a script of several statements, no parameters. */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function pgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    query: (text, params) => pool.query(text, params as any[]) as Promise<any>,
    exec: async (sql) => void (await pool.query(sql)),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({
          query: (t, p) => client.query(t, p as any[]) as Promise<any>,
          exec: async (sql) => void (await client.query(sql)),
        });
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

interface LiteQ {
  query: (t: string, p?: any[]) => Promise<{ rows: any[] }>;
  exec: (sql: string) => Promise<unknown>;
}

/** Wraps anything with PGlite's shape (`query`, `exec`, `transaction`). */
export function pgliteDb(lite: LiteQ & {
  transaction: <T>(fn: (tx: LiteQ) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}): Db {
  const wrap = (q: LiteQ): Queryable => ({
    query: (text, params) => q.query(text, params as any[]),
    exec: async (sql) => void (await q.exec(sql)),
  });
  return {
    ...wrap(lite),
    tx: (fn) => lite.transaction((t) => fn(wrap(t))),
    close: () => lite.close(),
  };
}
