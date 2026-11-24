import { test, expect, describe, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeUser, makeTrip, makeSegment, makeCompanion } from '../../../../../tests/helpers';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function event(user: { id: number }, tripId: number) {
	return {
		locals: { user } as App.Locals,
		params: { id: String(tripId) }
	} as any;
}

test('load returns trip, day-grouped segments, and companions', () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'print@x.c', displayName: 'U' });
	const t = makeTrip(kit, u.id, {
		name: 'Japan trip',
		destinationCountryCode: 'JP',
		destinationCityName: 'Tokyo',
		destinationCityLat: 35.6762,
		destinationCityLng: 139.6503,
		startDate: '2026-04-01',
		endDate: '2026-04-03'
	});
	makeSegment(kit, t.id, {
		type: 'flight',
		title: 'Outbound flight',
		startAt: '2026-04-01T09:00:00Z',
		location: 'NRT',
		confirmationNumber: 'ABC123'
	});
	makeSegment(kit, t.id, {
		type: 'hotel',
		title: 'Hotel check-in',
		startAt: '2026-04-01T15:00:00Z',
		location: 'Shinjuku'
	});
	makeCompanion(kit, t.id, { name: 'Ada', category: 'adult', notes: 'Friend' });
	makeCompanion(kit, t.id, { name: 'Leo', category: 'child' });

	const result = load(event(u, t.id)) as {
		trip: { name: string };
		segments: { title: string }[];
		companions: { name: string }[];
		owner: boolean;
		editor: boolean;
	};

	expect(result.trip.name).toBe('Japan trip');
	expect(result.segments).toHaveLength(2);
	expect(result.companions).toHaveLength(2);
	expect(result.companions.map((c) => c.name)).toEqual(['Ada', 'Leo']);
	expect(result.owner).toBe(true);
	expect(result.editor).toBe(true);
});

test('load rejects a trip the user cannot view', () => {
	const kit = kitDb();
	const owner = makeUser(kit, { email: 'owner@x.c', displayName: 'O' });
	const other = makeUser(kit, { email: 'other@x.c', displayName: 'X' });
	const t = makeTrip(kit, owner.id, { name: 'Private' });

	expect(() => load(event(other, t.id))).toThrow();
});

import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
const template = page.slice(0, page.indexOf('<style>'));
const printBlock = page.slice(page.indexOf('@media print'));

describe('print itinerary page theming', () => {
	test('print rules beat the inline theme colours', () => {
		// A style attribute outranks every selector, so each colour, background, border, or
		// shadow declaration in the print block needs !important to reach the paper.
		expect(printBlock).not.toMatch(/\b(?:color|background|border-color|box-shadow):\s*[^;!]+;/);
		for (const selector of [
			'.print-title',
			'.print-segment-title',
			'.print-meta',
			'.print-companion',
			'.print-segment-meta',
			'.print-segment-time',
			'.print-segment-details',
			'.print-header',
			'.print-day-title',
			'.badge',
			'.empty-text'
		]) {
			expect(printBlock, selector).toContain(selector);
		}
	});

	test('every fixed-palette text class carries a theme colour override', () => {
		const tags =
			template.match(/<[a-z0-9]+\b[^>]*\btext-(?:white|slate-\d{2,3}|indigo-\d{2,3})\b[^>]*>/g) ?? [];
		expect(tags.length).toBeGreaterThan(0);
		for (const tag of tags) expect(tag, tag).toMatch(/\bstyle="[^"]*\bcolor: var\(--theme-/);
	});

	test('the date arrow and companion details inherit the themed text colour', () => {
		expect(template).toContain('<span>→</span>');
		expect(template).toContain('<span class="capitalize">({c.category})</span>');
		expect(template).toContain('<span>— {c.notes}</span>');
	});
});
