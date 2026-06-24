import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import TimezoneSelect from './TimezoneSelect.svelte';

test('renders a select populated with valid IANA timezones and selects the value', () => {
	const { body } = render(TimezoneSelect, { props: { name: 'tz', value: 'America/New_York' } });
	expect(body).toContain('<select');
	expect(body).toContain('name="tz"');
	expect(body).toContain('America/New_York</option>');
	expect(body).toContain('Europe/London</option>');
	expect(body).toContain('UTC</option>');
	// Svelte SSR sets the select value attribute for non-first options.
	expect(body).toContain('value="America/New_York"');
});

test('defaults to UTC when no value is provided', () => {
	const { body } = render(TimezoneSelect, { props: { name: 'tz' } });
	expect(body).toContain('<select');
	expect(body).toContain('UTC</option>');
	expect(body).toContain('<option value="UTC" selected="">UTC</option>');
});

test('falls back to UTC when supportedValuesOf is unavailable', () => {
	const spy = vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
		throw new TypeError('unsupported');
	});
	const { body } = render(TimezoneSelect, { props: { name: 'tz' } });
	expect(body).toContain('<option value="UTC" selected="">UTC</option>');
	expect(body).not.toContain('America/New_York');
	spy.mockRestore();
});
