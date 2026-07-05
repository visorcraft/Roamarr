import { test, expect } from 'vitest';
import { requireSecret } from './boot';

const validSecret = 'dGVzdC1zZWNyZXQtMzJieXRlcy0wMTIzNDU2Nzg5YWI=';

test('requireSecret throws when unset', () => {
	expect(() => requireSecret(undefined)).toThrow(/ROAMARR_SECRET/);
});

test('requireSecret throws for an invalid secret format', () => {
	expect(() => requireSecret('present')).toThrow(/32-byte/);
});

test('requireSecret accepts a base64 32-byte secret', () => {
	expect(() => requireSecret(validSecret)).not.toThrow();
});
