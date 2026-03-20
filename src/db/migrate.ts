// Standalone migration runner — called via `npm run db:migrate`
// Runs all .sql files in src/db/migrations/ in sorted order.
import 'dotenv/config';
import { runMigrations, closePool } from './queries';

async function main(): Promise<void> {
  console.log('Running database migrations...');
  try {
    await runMigrations();
    console.log('Migrations complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
