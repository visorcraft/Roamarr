// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
import RentalCarForm from './RentalCarForm.svelte';

describe('RentalCarForm (client)', () => {
	const mounted: unknown[] = [];

	afterEach(() => {
		for (const app of mounted) {
			unmount(app);
		}
		mounted.length = 0;
		document.body.innerHTML = '';
	});

	function mountForm(props?: Record<string, unknown>) {
		const app = mount(RentalCarForm, { target: document.body, ...(props ? { props } : {}) });
		flushSync();
		mounted.push(app);
		return app;
	}

	function findLabel(text: string) {
		return [...document.querySelectorAll('label')].find(
			(label) => (label.textContent ?? '').trim() === text
		);
	}

	function findHeading(text: string) {
		return [...document.querySelectorAll('h3')].find((h) => (h.textContent ?? '').trim() === text);
	}

	function findButton(text: string) {
		return [...document.querySelectorAll('button')].find(
			(button) => (button.textContent ?? '').trim() === text
		);
	}

	function findInput(name: string) {
		return document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
	}

	function assertRendered() {
		expect(findLabel('Rental agency')).toBeTruthy();
		expect(findLabel('Pick-up date')).toBeTruthy();
		expect(findLabel('Drop-off timezone')).toBeTruthy();

		const title = findInput('title');
		expect(title).toBeTruthy();
		expect(title?.getAttribute('placeholder')).toBe('Enter rental agency');

		const totalCost = findInput('detail_totalCost');
		expect(totalCost).toBeTruthy();
		expect(totalCost?.getAttribute('placeholder')).toBe('Enter total cost');

		for (const heading of ['Pickup', 'Drop-off', 'Rental info', 'More details']) {
			expect(findHeading(heading)).toBeTruthy();
		}

		expect(findLabel('Same as pickup location')).toBeTruthy();
		expect(findButton('Expand all')).toBeTruthy();
		expect(document.body.textContent).toContain('Drivers');
	}

	it('renders the migrated strings from the catalog', () => {
		mountForm();
		assertRendered();
	});

	it('renders the same output with an empty errors object', () => {
		mountForm({ errors: {} });
		assertRendered();
	});

	it('toggles the drop-off location block via the sameAsPickup checkbox', () => {
		mountForm();

		expect(findInput('detail_dropoffLocation')).toBeNull();

		const checkbox = document.querySelector('#detail_sameAsPickup') as HTMLInputElement;
		expect(checkbox).toBeTruthy();
		checkbox.click();
		flushSync();

		const dropoffLocation = findInput('detail_dropoffLocation');
		expect(dropoffLocation).toBeTruthy();
		expect(dropoffLocation?.getAttribute('placeholder')).toBe('Enter drop-off location');

		checkbox.click();
		flushSync();

		expect(findInput('detail_dropoffLocation')).toBeNull();
	});
});
