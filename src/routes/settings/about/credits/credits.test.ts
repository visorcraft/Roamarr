import { expect, test } from 'vitest';
import { load } from './+page.server';

test('credits load returns package and runtime attribution rows', () => {
	const result = load({ locals: { user: { id: 1, role: 'user' } } } as any) as any;

	expect(result.packages.length).toBeGreaterThan(0);
	expect(result.packages.some((pkg: { name: string }) => pkg.name === 'svelte')).toBe(true);
	expect(result.runtimeComponents.some((component: { name: string }) => component.name === 'Node.js runtime')).toBe(true);
});
