import { describe, test, it, expect } from 'vitest';
import { encrypt, decrypt } from './crypto';

describe('crypto key', () => {
	it('returns a 32-byte buffer for aesKey', async () => {
		const { aesKey } = await import('./crypto');
		expect(aesKey()).toBeInstanceOf(Buffer);
		expect(aesKey().length).toBe(32);
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
