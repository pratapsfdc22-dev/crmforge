#!/usr/bin/env node

/**
 * ForgeSF Database Migration Runner
 * Applies SQL migrations to Supabase via psql
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../migrations');

// Load DATABASE_URL from api/.env
const envPath = join(__dirname, '../../../apps/api/.env');
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    const [, key, value] = match;
    env[key.trim()] = value.trim();
  }
});

const DATABASE_URL = env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL in apps/api/.env');
  process.exit(1);
}

function runMigration(filename) {
  const filepath = join(MIGRATIONS_DIR, filename);

  console.log(`📄 Running migration: ${filename}`);

  try {
    execSync(`psql "${DATABASE_URL}" < "${filepath}"`, {
      stdio: 'inherit',
      encoding: 'utf-8'
    });

    console.log(`✅ Migration complete: ${filename}\n`);
  } catch (err) {
    console.error(`❌ Migration failed: ${filename}`);
    console.error(err.message);
    process.exit(1);
  }
}

function main() {
  console.log('🚀 Starting database migrations...\n');

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('⚠️  No migration files found in', MIGRATIONS_DIR);
    return;
  }

  // Check if psql is available
  try {
    execSync('which psql', { stdio: 'ignore' });
  } catch {
    console.error('❌ psql not found. Install PostgreSQL client tools:');
    console.error('   brew install libpq');
    console.error('   Or use Supabase SQL Editor: https://supabase.com/dashboard');
    process.exit(1);
  }

  for (const file of files) {
    runMigration(file);
  }

  console.log('✅ All migrations complete!');
  console.log('\n💡 Next steps:');
  console.log('   1. Run `pnpm --filter @forgesf/db generate` to generate TypeScript types');
  console.log('   2. Verify tables in Supabase Dashboard: https://supabase.com/dashboard');
}

main();
