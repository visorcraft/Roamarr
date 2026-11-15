import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import * as m from '$lib/paraglide/messages';

// Guards against an empty or incomplete compiled catalog (for example a plugin that failed to
// load), and against keys added to messages/en.json that never reach the compiled output.
const catalog = JSON.parse(readFileSync(new URL('../../messages/en.json', import.meta.url), 'utf8'));
const keys = Object.keys(catalog).filter((key) => key !== '$schema');

// Every message accepts an inputs object; any variable it reads gets a placeholder value.
const anyInputs = new Proxy({}, { get: () => 'x' });

test('the English catalog is not empty', () => {
	expect(keys.length).toBeGreaterThan(0);
});

test.each(keys)('message %s is compiled to a function returning a non-empty string', (key) => {
	const fn = (m as Record<string, unknown>)[key];
	expect(typeof fn).toBe('function');
	const text = (fn as (inputs: unknown) => unknown)(anyInputs);
	expect(typeof text).toBe('string');
	expect((text as string).length).toBeGreaterThan(0);
});
