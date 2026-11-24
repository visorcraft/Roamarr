// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
import TripCard from './TripCard.svelte';

describe('TripCard (client)', () => {
	const mounted: unknown[] = [];

	afterEach(() => {
		for (const app of mounted) {
			unmount(app);
		}
		mounted.length = 0;
		document.body.innerHTML = '';
	});

	function mountCard(props?: Record<string, unknown>) {
		const app = mount(TripCard, { target: document.body, ...(props ? { props } : {}) });
		flushSync();
		mounted.push(app);
		return app;
	}

	function visibleText(el: Element): string {
		const clone = el.cloneNode(true) as Element;
		for (const srOnly of clone.querySelectorAll('.sr-only')) {
			srOnly.remove();
		}
		return (clone.textContent ?? '').trim();
	}

	const fixture = {
		id: 7,
		name: 'Paris 2027',
		destinationCityName: 'Paris',
		destinationCountryCode: 'FR',
		startDate: '2027-03-14',
		endDate: '2027-03-20',
		tags: ['honeymoon'],
		status: 'booked'
	};

	it('renders a favorite trip with a themed star, sr-only label, and no title attribute', () => {
		mountCard({ trip: { ...fixture, favorite: true } });

		const h2 = document.querySelector('h2') as HTMLElement;
		expect(h2).toBeTruthy();
		expect(visibleText(h2)).toBe('Paris 2027');

		const svgs = [...h2.querySelectorAll('svg')];
		expect(svgs).toHaveLength(1);
		const svg = svgs[0];
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		const classAttr = svg.getAttribute('class') ?? '';
		expect(classAttr).toContain('fill-current');
		expect(classAttr).toContain('text-[var(--theme-readable-warning)]');
		expect(classAttr).not.toContain('text-yellow-400');

		const srOnly = h2.querySelector('.sr-only');
		expect(srOnly?.textContent?.trim()).toBe('Favorite');

		expect(document.body.textContent).not.toContain('★');
		expect(document.querySelector('[title="Favorite"]')).toBeNull();

		const link = document.querySelector('a[href="/trips/7"]') as HTMLAnchorElement;
		expect(link).toBeTruthy();
		expect(link.getAttribute('aria-label')).toBe('Paris 2027');
	});

	it.each([false, undefined])('renders the plain heading for favorite=%s', (favorite) => {
		const trip: Record<string, unknown> = { ...fixture };
		if (favorite !== undefined) {
			trip.favorite = favorite;
		}
		mountCard({ trip });

		const h2 = document.querySelector('h2') as HTMLElement;
		expect(h2).toBeTruthy();
		expect(h2.querySelector('svg')).toBeNull();
		expect(document.querySelector('.sr-only')).toBeNull();
		expect(h2.textContent?.trim()).toBe('Paris 2027');
	});

	it('renders the card chrome with showCheckbox', () => {
		mountCard({ trip: { ...fixture }, showCheckbox: true });

		const brandBadge = document.querySelector('span.badge.badge-brand');
		expect(brandBadge?.textContent?.trim()).toBe('Booked');

		const slateBadge = [...document.querySelectorAll('span.badge')].find(
			(badge) => badge.textContent?.trim() === 'private'
		);
		expect(slateBadge).toBeTruthy();
		expect([...document.querySelectorAll('span.badge')].some((badge) => badge.textContent?.trim() === 'Shared')).toBe(false);

		const paragraphs = [...document.querySelectorAll('p')];
		expect(paragraphs.some((p) => (p.textContent ?? '').includes('Paris'))).toBe(true);

		const tagBadge = [...document.querySelectorAll('span.badge.badge-slate')].find(
			(badge) => badge.textContent?.trim() === 'honeymoon'
		);
		expect(tagBadge).toBeTruthy();

		expect(document.body.textContent).toContain('2027-03-14');
		expect(document.body.textContent).toContain('2027-03-20');

		const checkbox = document.querySelector('input[name="selected"]') as HTMLInputElement;
		expect(checkbox).toBeTruthy();
		expect(checkbox.value).toBe('7');
		expect(checkbox.getAttribute('aria-label')).toBe('Select Paris 2027');
	});

	it('hides the checkbox and renders a Shared badge when isShared', () => {
		mountCard({ trip: { ...fixture, isShared: true }, showCheckbox: true });

		expect(document.querySelector('input[name="selected"]')).toBeNull();
		const sharedBadge = [...document.querySelectorAll('span.badge')].find(
			(badge) => badge.textContent?.trim() === 'Shared'
		);
		expect(sharedBadge).toBeTruthy();
	});
});
