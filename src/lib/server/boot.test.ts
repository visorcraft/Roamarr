import { test, expect } from 'vitest';
import { requireSecret } from './boot';

test('requireSecret throws when unset', () => {
	expect(() => requireSecret(undefined)).toThrow(/ROAMARR_SECRET/);
	expect(() => requireSecret('present')).not.toThrow();
});
