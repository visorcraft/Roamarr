import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';

const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

test('draws the emergency-contact separator with the theme line colour', () => {
	expect(src).toContain('class="mt-6 grid gap-3 border-t border-line pt-5 sm:grid-cols-2"');
	expect(src).not.toContain('border-white/');
});
