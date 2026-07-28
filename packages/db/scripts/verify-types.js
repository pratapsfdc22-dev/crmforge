#!/usr/bin/env node

/**
 * Verify that packages/db/src/types.ts matches the actual database schema
 * for the newly added connection tables
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

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

const TABLES_TO_CHECK = [
  'connection_secrets',
  'sf_connections',
  'jira_connections',
  'n8n_connections'
];

async function verifySchema() {
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    for (const tableName of TABLES_TO_CHECK) {
      console.log(`📋 Checking table: ${tableName}`);

      const result = await client.query(`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      if (result.rows.length === 0) {
        console.log(`   ❌ Table ${tableName} does not exist in database!`);
        continue;
      }

      console.log(`   Found ${result.rows.length} columns:`);
      result.rows.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'nullable' : 'required';
        console.log(`     - ${col.column_name}: ${col.data_type} (${nullable})`);
      });
      console.log('');
    }

    // Now check what's in types.ts
    console.log('📝 Checking types.ts...\n');
    const typesPath = join(__dirname, '../src/types.ts');
    const typesContent = readFileSync(typesPath, 'utf-8');

    for (const tableName of TABLES_TO_CHECK) {
      const tableRegex = new RegExp(`${tableName}:\\s*{[\\s\\S]*?}\\s*}\\s*}`, 'm');
      const match = typesContent.match(tableRegex);

      if (match) {
        console.log(`✅ ${tableName} type definition found in types.ts`);
      } else {
        console.log(`❌ ${tableName} type definition NOT found in types.ts`);
      }
    }

    console.log('\n✅ Schema verification complete');
    console.log('\nℹ️  Manual verification needed:');
    console.log('   1. Compare column names above with Row/Insert types in types.ts');
    console.log('   2. Check data type mappings (uuid->string, text->string, etc.)');
    console.log('   3. Verify nullable columns are marked with | null in types');

  } catch (error) {
    // Sanitize error message to remove any potential credentials
    let sanitizedMessage = error.message || 'Unknown error';

    // Strip connection strings (postgresql://user:password@host:port/db)
    sanitizedMessage = sanitizedMessage.replace(
      /postgresql:\/\/[^:]+:[^@]+@/g,
      'postgresql://[REDACTED]@'
    );

    // Strip any remaining password-like patterns
    sanitizedMessage = sanitizedMessage.replace(
      /password[=:]\s*[^\s]+/gi,
      'password=[REDACTED]'
    );

    console.error('❌ Error:', sanitizedMessage);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verifySchema();
