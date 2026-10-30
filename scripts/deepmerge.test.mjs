import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.resolve('@sveltejs/vite-plugin-svelte'));

// Both published bundles must retain the prototype-poisoning patch after npm ci.
for (const bundle of ['deepmerge', 'deepmerge/dist/umd.js']) {
	const merge = require(bundle);
	describe(bundle, () => {
		it('ignores prototype keys when merging into null-prototype targets', () => {
			const merged = merge(Object.create(null), JSON.parse('{"__proto__":{"admin":true},"safe":1}'));
			expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
			expect(merged.admin).toBeUndefined();
			expect(Object.hasOwn(merged, '__proto__')).toBe(false);
			expect(merged.safe).toBe(1);
		});

		it('ignores prototype keys copied from the target', () => {
			const target = JSON.parse('{"__proto__":{"admin":true},"safe":1}');
			const merged = merge(target, { next: 2 });
			expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
			expect(merged.admin).toBeUndefined();
			expect(Object.hasOwn(merged, '__proto__')).toBe(false);
			expect(merged).toEqual({ safe: 1, next: 2 });
		});

		it.each([null, undefined, 0])('blocks nested prototype keys with placeholder %s', (session) => {
			const merged = merge({ session }, JSON.parse('{"session":{"__proto__":{"admin":true},"safe":1}}'));
			expect(Object.getPrototypeOf(merged.session)).toBe(Object.prototype);
			expect(merged.session.admin).toBeUndefined();
			expect(merged.session.safe).toBe(1);
			expect(Object.hasOwn(Object.prototype, 'admin')).toBe(false);
		});

		it('preserves nested options, custom array replacement, and enumerable symbols', () => {
			const symbol = Symbol('option');
			const target = { compilerOptions: { dev: true }, preprocess: ['old'], [symbol]: 'old' };
			const source = { compilerOptions: { async: true }, preprocess: ['new'], [symbol]: 'new' };
			const merged = merge(target, source, { arrayMerge: (_target, source) => source });
			expect(merged).toEqual({ compilerOptions: { dev: true, async: true }, preprocess: ['new'], [symbol]: 'new' });
			expect(target.compilerOptions).toEqual({ dev: true });
		});
	});
}
