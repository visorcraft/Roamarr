// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM mount harness
import { mount, unmount } from '../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../node_modules/svelte/src/internal/client/reactivity/batch.js';

// Force the bare `svelte` specifier to its client build. Vitest runs under the
// node condition, which otherwise resolves `svelte` to index-server.js and makes
// lifecycle functions throw during this jsdom mount harness.
// @ts-ignore — internal Svelte client runtime
vi.mock('svelte', async () => await import('../../../node_modules/svelte/src/index-client.js'));

// Stub the kit modules the page imports but never calls in this flow.
vi.mock('$app/forms', () => ({ enhance: () => {} }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
// The modal components gate mount work on `$app/env` browser.
vi.mock('$app/env', () => ({ browser: true, dev: false, building: false, version: '0.0.0' }));

import { tick } from 'svelte';
import EditCardPage from './[id]/edit/+page.svelte';

function buildData() {
	return {
		card: { id: 1, nickname: 'Sapphire Reserve', network: 'visa', last4: '1234', notes: null },
		benefits: [],
		templates: [{ id: 3, name: 'Airport Lounge', benefitType: 'trip_delay' }],
		user: { defaultCurrency: 'USD' }
	} as any;
}

describe('cards/[id]/edit template select (client)', () => {
	const mounted: unknown[] = [];

	afterEach(() => {
		for (const app of mounted) {
			unmount(app);
		}
		mounted.length = 0;
		document.body.innerHTML = '';
	});

	it('keeps the chosen template selected, shows the hint, and locks benefitType', async () => {
		const app = mount(EditCardPage, {
			target: document.body,
			props: { data: buildData(), form: undefined } as any
		});
		flushSync();
		mounted.push(app);

		const select = document.querySelector('select#templateId') as HTMLSelectElement;
		expect(select).toBeTruthy();

		select.value = '3';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();

		expect(select.value).toBe('3');
		expect(document.body.textContent).toContain('Using Airport Lounge');
		const benefitType = document.querySelector('select#benefitType') as HTMLSelectElement;
		expect(benefitType).toBeTruthy();
		expect(benefitType.disabled).toBe(true);
	});
});
