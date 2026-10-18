import { pgDb } from './db';
import { migrate } from './migrate';
import { seedDemo } from './seed';
import { buildApp } from './app';

const url = process.env.DATABASE_URL ?? 'postgres://nodeboard:nodeboard@localhost:5432/nodeboard';
const db = pgDb(url);

const applied = await migrate(db);
if (applied.length) console.log('migrations applied:', applied.join(', '));
if (process.env.SEED_DEMO === '1' && (await db.tx(seedDemo))) console.log('seeded demo workspace "Studio"');

const app = await buildApp(db, { logger: true });
const port = Number(process.env.PORT ?? 3000);
await app.listen({ host: process.env.HOST ?? '0.0.0.0', port });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}
