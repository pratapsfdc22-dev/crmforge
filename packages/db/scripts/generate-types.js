#!/usr/bin/env node

/**
 * Generate TypeScript types from Supabase schema
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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

let DATABASE_URL = env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL in apps/api/.env');
  process.exit(1);
}

// URL-encode special characters in password if needed
// Format: postgresql://user:password@host:port/db
// Use a non-greedy match for password to stop at the last @
const urlMatch = DATABASE_URL.match(/^postgresql:\/\/([^:]+):(.+)@([^@]+)$/);
if (urlMatch) {
  const [, user, password, rest] = urlMatch;
  // Only encode if password contains special characters
  if (password.includes('[') || password.includes(']') || password.includes('@') || password.includes('%')) {
    const encodedPassword = encodeURIComponent(password);
    DATABASE_URL = `postgresql://${user}:${encodedPassword}@${rest}`;
    console.log('🔐 Password contains special characters, using URL encoding');
  }
}

const outputPath = join(__dirname, '../src/types.ts');

console.log('🚀 Generating TypeScript types from Supabase schema...\n');

try {
  const types = execSync(
    `supabase gen types typescript --db-url "${DATABASE_URL}"`,
    { encoding: 'utf-8' }
  );

  writeFileSync(outputPath, types);

  console.log(`✅ Types generated successfully!`);
  console.log(`   Output: packages/db/src/types.ts\n`);
} catch (err) {
  console.error('❌ Failed to generate types:');
  console.error(err.message);
  process.exit(1);
}
