import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, prepareSecret, unwrapSecret } from './vault';

const TEST_MASTER_KEY = 'test-master-key-32-characters!!';

describe('Vault - Encryption/Decryption', () => {
  it('should encrypt and decrypt a simple string', () => {
    const plaintext = 'secret-password-123';
    const encrypted = encrypt(plaintext, TEST_MASTER_KEY);
    const decrypted = decrypt(encrypted, TEST_MASTER_KEY);

    expect(decrypted).toBe(plaintext);
  });

  it('should encrypt and decrypt JSON payload', () => {
    const payload = {
      accessToken: 'access_token_xyz',
      refreshToken: 'refresh_token_abc',
      expiresAt: '2026-12-31T23:59:59Z'
    };

    const { encPayload, keyVersion } = prepareSecret(payload, TEST_MASTER_KEY);
    const decrypted = unwrapSecret(encPayload, TEST_MASTER_KEY, keyVersion);

    expect(decrypted).toEqual(payload);
  });

  it('should produce different ciphertexts for same plaintext (due to random IV)', () => {
    const plaintext = 'same-secret';
    const encrypted1 = encrypt(plaintext, TEST_MASTER_KEY);
    const encrypted2 = encrypt(plaintext, TEST_MASTER_KEY);

    // Ciphertexts should differ (random IV)
    expect(encrypted1.equals(encrypted2)).toBe(false);

    // But both should decrypt to same plaintext
    expect(decrypt(encrypted1, TEST_MASTER_KEY)).toBe(plaintext);
    expect(decrypt(encrypted2, TEST_MASTER_KEY)).toBe(plaintext);
  });

  it('should fail decryption with wrong master key', () => {
    const plaintext = 'secret';
    const encrypted = encrypt(plaintext, TEST_MASTER_KEY);

    expect(() => {
      decrypt(encrypted, 'wrong-master-key-32-characters!');
    }).toThrow('authentication tag mismatch');
  });

  it('should detect tampering - modified ciphertext', () => {
    const plaintext = 'secret';
    const encrypted = encrypt(plaintext, TEST_MASTER_KEY);

    // Tamper with last byte of ciphertext
    encrypted[encrypted.length - 1] ^= 0xFF;

    expect(() => {
      decrypt(encrypted, TEST_MASTER_KEY);
    }).toThrow('authentication tag mismatch');
  });

  it('should detect tampering - modified auth tag', () => {
    const plaintext = 'secret';
    const encrypted = encrypt(plaintext, TEST_MASTER_KEY);

    // Tamper with auth tag (bytes 48-63)
    encrypted[50] ^= 0xFF;

    expect(() => {
      decrypt(encrypted, TEST_MASTER_KEY);
    }).toThrow('authentication tag mismatch');
  });

  it('should detect tampering - modified IV', () => {
    const plaintext = 'secret';
    const encrypted = encrypt(plaintext, TEST_MASTER_KEY);

    // Tamper with IV (bytes 32-47)
    encrypted[35] ^= 0xFF;

    expect(() => {
      decrypt(encrypted, TEST_MASTER_KEY);
    }).toThrow('authentication tag mismatch');
  });

  it('should reject payload that is too short', () => {
    const tooShort = Buffer.alloc(40); // Need at least 64 bytes

    expect(() => {
      decrypt(tooShort, TEST_MASTER_KEY);
    }).toThrow('too short');
  });

  it('should handle empty string', () => {
    const plaintext = '';
    const encrypted = encrypt(plaintext, TEST_MASTER_KEY);
    const decrypted = decrypt(encrypted, TEST_MASTER_KEY);

    expect(decrypted).toBe('');
  });

  it('should handle large payloads', () => {
    const largePlaintext = 'x'.repeat(100000);
    const encrypted = encrypt(largePlaintext, TEST_MASTER_KEY);
    const decrypted = decrypt(encrypted, TEST_MASTER_KEY);

    expect(decrypted).toBe(largePlaintext);
  });

  it('should handle unicode characters', () => {
    const unicode = '你好世界 🌍 émojis';
    const encrypted = encrypt(unicode, TEST_MASTER_KEY);
    const decrypted = decrypt(encrypted, TEST_MASTER_KEY);

    expect(decrypted).toBe(unicode);
  });

  it('should support key versioning', () => {
    const plaintext = 'secret';

    // Encrypt with version 1
    const encrypted1 = encrypt(plaintext, TEST_MASTER_KEY, 1);
    expect(decrypt(encrypted1, TEST_MASTER_KEY, 1)).toBe(plaintext);

    // Encrypt with version 2
    const encrypted2 = encrypt(plaintext, TEST_MASTER_KEY, 2);
    expect(decrypt(encrypted2, TEST_MASTER_KEY, 2)).toBe(plaintext);

    // Version 1 key cannot decrypt version 2 payload
    expect(() => {
      decrypt(encrypted2, TEST_MASTER_KEY, 1);
    }).toThrow('authentication tag mismatch');
  });

  it('should reject missing master key', () => {
    expect(() => {
      encrypt('secret', '');
    }).toThrow('Master encryption key is required');

    expect(() => {
      decrypt(Buffer.alloc(64), '');
    }).toThrow('Master encryption key is required');
  });

  it('should reject invalid JSON in unwrapSecret', () => {
    const invalidJson = 'not-json-data';
    const encrypted = encrypt(invalidJson, TEST_MASTER_KEY);

    expect(() => {
      unwrapSecret(encrypted, TEST_MASTER_KEY);
    }).toThrow('not valid JSON');
  });

  it('should handle complex nested JSON structures', () => {
    const complex = {
      user: {
        id: '123',
        credentials: {
          oauth: {
            accessToken: 'abc',
            refreshToken: 'def',
            scopes: ['read', 'write']
          }
        }
      },
      metadata: {
        createdAt: '2026-07-27',
        expiresAt: null
      }
    };

    const { encPayload, keyVersion } = prepareSecret(complex, TEST_MASTER_KEY);
    const decrypted = unwrapSecret(encPayload, TEST_MASTER_KEY, keyVersion);

    expect(decrypted).toEqual(complex);
  });
});
