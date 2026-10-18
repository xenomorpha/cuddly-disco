// npm run migrate | seed | reindex [workspaceId] | openapi | import <workspace.json>
import { readFile } from 'node:fs/promises';
import { pgDb, type Db } from './db';
import { migrate } from './migrate';
import { seedDemo } from './seed';
import { reindexWorkspace } from './linkIndex';
import { importWorkspace } from './importWorkspace';
import { buildApp } from './app';

const [cmd, arg] = process.argv.slice(2);
const connect = () => pgDb(process.env.DATABASE_URL ?? 'postgres://nodeboard:nodeboard@localhost:5432/nodeboard');

async function run(fn: (db: Db) => Promise<void>) {
  const db = connect();
  try {
    await fn(db);
  } finally {
    await db.close();
  }
}

switch (cmd) {
  case 'migrate':
    await run(async (db) => console.log('applied:', (await migrate(db)).join(', ') || 'nothing'));
    break;
  case 'seed':
    await run(async (db) => {
      await migrate(db);
      console.log((await db.tx(seedDemo)) ? 'seeded demo workspace' : 'demo workspace already present');
    });
    break;
  case 'reindex':
    await run(async (db) => {
      const ids = arg ? [arg] : (await db.query<{ id: string }>('select id from workspaces')).rows.map((r) => r.id);
      for (const id of ids) console.log(id, await db.tx((q) => reindexWorkspace(q, id)));
    });
    break;
  case 'import':
    if (!arg) throw new Error('usage: import <workspace.json>');
    await run(async (db) => {
      await migrate(db);
      const doc = JSON.parse(await readFile(arg, 'utf8'));
      await db.tx((q) => importWorkspace(q, doc));
      console.log('imported workspace', doc.id);
    });
    break;
  case 'openapi': {
    // no database needed to describe the routes
    const app = await buildApp({} as Db);
    await app.ready();
    process.stdout.write(JSON.stringify(app.swagger(), null, 2) + '\n');
    await app.close();
    break;
  }
  default:
    console.error('usage: cli.ts migrate | seed | reindex [workspaceId] | import <file.json> | openapi');
    process.exit(1);
}
