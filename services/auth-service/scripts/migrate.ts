/**
 * Migration runner for auth-service.
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
    ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
  });

  const dir = join(__dirname, '..', '..', '..', 'database', 'postgres', 'migrations');

  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    console.error(`[migrate] migrations directory not found: ${dir}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log('[migrate] no .sql files found — nothing to do');
    await pool.end();
    return;
  }

  for (const file of files) {
    console.log(`→ Applying ${file}`);
    const sql = await readFile(join(dir, file), 'utf-8');
    await pool.query(sql);
  }

  await pool.end();
  console.log(`✅ ${files.length} migrations applied`);
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});