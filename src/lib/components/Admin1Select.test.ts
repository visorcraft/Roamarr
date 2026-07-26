import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import Admin1Select from './Admin1Select.svelte';

test('Admin1Select SSR preserves stored value via hidden input until options load', () => {
	const { body } = render(Admin1Select, {
		props: { countryCode: 'US', name: 'destinationAdmin1Code', value: 'TX' }
	});
	// Client fetch has not run — still must submit the stored code on edit save
	expect(body).toContain('name="destinationAdmin1Code"');
	expect(body).toContain('value="TX"');
	expect(body).toMatch(/type="hidden"/i);
});

test('Admin1Select SSR omits field when no stored value (country not applicable yet)', () => {
	const { body } = render(Admin1Select, {
		props: { countryCode: 'US', name: 'destinationAdmin1Code', value: '' }
	});
	expect(body).not.toContain('name="destinationAdmin1Code"');
});

test('Admin1Select SSR omits field when country is empty', () => {
	const { body } = render(Admin1Select, {
		props: { countryCode: '', name: 'admin1Code', value: 'TX' }
	});
	// Country cleared → value cleared in effect; no field
	expect(body).not.toContain('name="admin1Code"');
});

test('Admin1Select source is imported by trip and segment forms', async () => {
	const fs = await import('node:fs');
	const path = await import('node:path');
	const root = process.cwd();
	const files = [
		'src/routes/trips/new/+page.svelte',
		'src/routes/trips/[id]/edit/+page.svelte',
		'src/lib/components/segments/forms/StandardPlanForm.svelte',
		'src/lib/components/segments/forms/EventForm.svelte',
		'src/lib/components/segments/forms/FlightForm.svelte',
		'src/lib/components/segments/SegmentEditForm.svelte'
	];
	for (const f of files) {
		const src = fs.readFileSync(path.join(root, f), 'utf8');
		expect(src, f).toMatch(/Admin1Select/);
	}
});
