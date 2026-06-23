import { test, expect } from 'vitest';
import { encrypt, decrypt } from './crypto';

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
