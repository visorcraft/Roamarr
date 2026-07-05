import { describe, test, it, expect } from 'vitest';
import { encrypt, decrypt, validateSecretFormat } from './crypto';

describe('crypto key', () => {
	it('returns a 32-byte buffer for aesKey', async () => {
		const { aesKey } = await import('./crypto');
		expect(aesKey()).toBeInstanceOf(Buffer);
		expect(aesKey().length).toBe(32);
	});
});

describe('validateSecretFormat', () => {
	it('accepts a base64 32-byte value', () => {
		const result = validateSecretFormat('dGVzdC1zZWNyZXQtMzJieXRlcy0wMTIzNDU2Nzg5YWI=');
		expect(result.ok).toBe(true);
	});

	it('rejects a non-base64 string', () => {
		const result = validateSecretFormat('not-valid-base64!!!');
		expect(result.ok).toBe(false);
	});

	it('rejects a base64 value that is not 32 bytes', () => {
		const result = validateSecretFormat('dGVzdA==');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('32-byte');
	});
});

test('round-trips', () => {
	expect(decrypt(encrypt('passport-42'))).toBe('passport-42');
});

test('uses a fresh nonce per call', () => {
	expect(encrypt('same')).not.toBe(encrypt('same'));
});

test('rejects tampered ciphertext', () => {
	const blob = encrypt('secret');
	const bad = blob.slice(0, -2) + 'AA';
	expect(() => decrypt(bad)).toThrow();
});
