/**
 * Vault module for encrypting/decrypting connection secrets
 * Uses AES-256-GCM with a data key derived from MASTER_ENC_KEY
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

export interface EncryptedPayload {
  encPayload: Buffer;
  keyVersion: number;
}

export interface SecretMetadata {
  orgId: string;
  userId: string | null;
  kind: string;
}

/**
 * Derive a data key from the master encryption key using PBKDF2
 */
function deriveKey(masterKey: string, salt: Buffer, keyVersion: number): Buffer {
  // Include keyVersion in derivation to support key rotation
  const versionedMasterKey = `${masterKey}:v${keyVersion}`;
  return pbkdf2Sync(versionedMasterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a secret payload
 * Format: [salt(32)][iv(16)][authTag(16)][ciphertext]
 */
export function encrypt(plaintext: string, masterKey: string, keyVersion: number = 1): Buffer {
  if (!masterKey) {
    throw new Error('Master encryption key is required');
  }

  // Generate random salt and IV
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  // Derive encryption key
  const key = deriveKey(masterKey, salt, keyVersion);

  // Encrypt
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  // Combine: salt + iv + authTag + ciphertext
  return Buffer.concat([salt, iv, authTag, ciphertext]);
}

/**
 * Decrypt an encrypted payload
 * Throws if authentication fails (tamper detection)
 */
export function decrypt(encryptedBuffer: Buffer, masterKey: string, keyVersion: number = 1): string {
  if (!masterKey) {
    throw new Error('Master encryption key is required');
  }

  if (encryptedBuffer.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted payload: too short');
  }

  // Extract components
  let offset = 0;
  const salt = encryptedBuffer.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;

  const iv = encryptedBuffer.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;

  const authTag = encryptedBuffer.subarray(offset, offset + AUTH_TAG_LENGTH);
  offset += AUTH_TAG_LENGTH;

  const ciphertext = encryptedBuffer.subarray(offset);

  // Derive decryption key
  const key = deriveKey(masterKey, salt, keyVersion);

  // Decrypt
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    return plaintext.toString('utf8');
  } catch (error) {
    // Auth tag verification failed - data was tampered with
    throw new Error('Decryption failed: authentication tag mismatch (possible tampering)');
  }
}

/**
 * Store a secret in the vault
 * This is a pure function - database storage is handled by the caller
 */
export function prepareSecret(
  payload: Record<string, unknown>,
  masterKey: string,
  keyVersion: number = 1
): EncryptedPayload {
  const plaintext = JSON.stringify(payload);
  const encPayload = encrypt(plaintext, masterKey, keyVersion);
  return { encPayload, keyVersion };
}

/**
 * Load and decrypt a secret from the vault
 */
export function unwrapSecret<T = Record<string, unknown>>(
  encPayload: Buffer,
  masterKey: string,
  keyVersion: number = 1
): T {
  const plaintext = decrypt(encPayload, masterKey, keyVersion);
  try {
    return JSON.parse(plaintext) as T;
  } catch (error) {
    throw new Error('Invalid secret payload: not valid JSON');
  }
}
