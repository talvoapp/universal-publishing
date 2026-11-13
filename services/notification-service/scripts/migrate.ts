/**
 * Migration runner for notification-service.
 *
 * Applies all .sql files in `internal/db/migrations/` in lexicographic
 * order against DATABASE_URL.
 *
 * Usage: npx tsx scripts/migrate.ts
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { Pool } from 'pg';
import { config } from '../src/config';

async function main() {
  const pool = new Pool({
    connectionString: config.database.url,
    ssl: { rejectUnauthorized: false },
  });

  const dir = join(__dirname, '..', 'internal', 'db', 'migrations');
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    console.log(`→ Applying ${file}`);
    const sql = await readFile(join(dir, file), 'utf-8');
    await pool.query(sql);
  }

  await pool.end();
  console.log(`✅ ${files.length} migrations applied`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});