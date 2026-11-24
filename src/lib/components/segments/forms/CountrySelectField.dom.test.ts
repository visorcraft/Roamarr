// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
// Force the bare `svelte` specifier to its client build. Vitest runs under the
// node condition, which otherwise resolves `svelte` to index-server.js and makes
// getContext throw (no SSR context) in this jsdom mount harness.
// @ts-ignore — internal Svelte client runtime
vi.mock('svelte', async () => await import('../../../../../node_modules/svelte/src/index-client.js'));
import EventForm from './EventForm.svelte';
import FlightForm from './FlightForm.svelte';
import StandardPlanForm from './StandardPlanForm.svelte';
import { COUNTRIES } from '$lib/countries';
import { SEGMENT_CITY_DEFAULTS_KEY } from '../segmentCityDefaults';
import { m } from '$lib/paraglide/messages';

type CountryForm = typeof EventForm;

const cases: Array<{
	name: string;
	Form: CountryForm;
	labelFn: () => string;
	placeholderFn: () => string;
}> = [
	{ name: 'EventForm', Form: EventForm, labelFn: m.event_country_label, placeholderFn: m.event_country_placeholder },
	{ name: 'FlightForm', Form: FlightForm, labelFn: m.flight_country_label, placeholderFn: m.flight_country_placeholder },
	{ name: 'StandardPlanForm', Form: StandardPlanForm, labelFn: m.plan_country_label, placeholderFn: m.plan_country_placeholder }
];

describe('CountrySelectField (client)', () => {
	const mounted: unknown[] = [];

	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		for (const app of mounted) {
			unmount(app);
		}
		mounted.length = 0;
		document.body.innerHTML = '';
	});

	function mountForm(Form: CountryForm, props?: Record<string, unknown>) {
		const app = mount(Form, {
			target: document.body,
			context: new Map([[SEGMENT_CITY_DEFAULTS_KEY, undefined]]),
			...(props ? { props } : {})
		});
		flushSync();
		mounted.push(app);
		return app;
	}

	function getSelect(): HTMLSelectElement {
		const el = document.querySelector('select[name="countryCode"]');
		if (!el) throw new Error('country select not found');
		return el as HTMLSelectElement;
	}

	describe.each(cases)('$name', ({ Form, labelFn, placeholderFn }) => {
		it('wires country errors through SelectField', () => {
			mountForm(Form, { errors: { countryCode: 'Pick a country' } });

			const select = getSelect();
			expect(select.id).toBe('countryCode');
			expect(select.classList.contains('input-error')).toBe(true);
			expect(select.getAttribute('aria-invalid')).toBe('true');
			expect(select.getAttribute('aria-describedby')).toBe('countryCode-countryCode-error');

			const label = document.querySelector('label[for="countryCode"]');
			expect(label?.textContent?.trim()).toBe(labelFn());

			const errorEl = document.getElementById('countryCode-countryCode-error');
			expect(errorEl).toBeTruthy();
			expect(errorEl?.tagName).toBe('P');
			expect(errorEl?.classList.contains('field-error')).toBe(true);
			expect(errorEl?.textContent?.trim()).toBe('Pick a country');
			expect(select.closest('.field')).toBe(errorEl?.closest('.field'));

			expect(select.options.length).toBe(COUNTRIES.length + 1);
			expect(select.options[0].value).toBe('');
			expect(select.options[0].textContent?.trim()).toBe(placeholderFn());
		});

		it('renders a clean country select without errors', () => {
			mountForm(Form);

			const select = getSelect();
			expect(select.getAttribute('aria-invalid')).toBeNull();
			expect(select.getAttribute('aria-describedby')).toBeNull();
			expect(select.classList.contains('input-error')).toBe(false);

			const wrapper = select.closest('.field');
			expect(wrapper).toBeTruthy();
			expect(wrapper?.querySelector('.field-error')).toBeNull();
		});
	});

	it('StandardPlanForm keeps a stored country pre-filled', () => {
		mountForm(StandardPlanForm, { countryCode: 'JP' });

		const select = getSelect();
		flushSync();
		expect(select.value).toBe('JP');
	});

	it('StandardPlanForm keeps the Admin1Select in sync when the country changes', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({ admin1: [{ code: 'TX', name: 'Texas' }, { code: 'CA', name: 'California' }] })
		} as Response);
		mountForm(StandardPlanForm, { countryCode: '' });

		const select = getSelect();
		select.value = 'US';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();

		await vi.waitFor(() => {
			expect(document.querySelector('select[name="admin1Code"]')).toBeTruthy();
		});

		const admin1 = document.querySelector('select[name="admin1Code"]') as HTMLSelectElement;
		expect(admin1).toBeTruthy();
		const optionTexts = [...admin1.options].map((o) => o.textContent?.trim());
		expect(optionTexts).toContain('Texas');
		expect(optionTexts).toContain('California');
	});
});
