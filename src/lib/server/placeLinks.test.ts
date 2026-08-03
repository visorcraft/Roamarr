import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

import {
	listPlaceLinks,
	getPlaceLinkById,
	createPlaceLink,
	updatePlaceLink,
	deletePlaceLink
} from './placeLinks';
import { createPlace } from './places';
import { placeLinks, places, users, auditLogs } from './db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import { makeUser } from '../../../tests/helpers';

let userId: number;
let otherUserId: number;

beforeEach(() => {
	ctx.kit.deleteFrom(placeLinks).executeSync();
	ctx.kit.deleteFrom(places).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	userId = makeUser(ctx.kit, { email: 'pl-a@x.c' }).id;
	otherUserId = makeUser(ctx.kit, { email: 'pl-b@x.c' }).id;
});

afterAll(() => {
	ctx.close();
});

function seedPlace(ownerId = userId) {
	return createPlace(ownerId, { name: 'Cafe Central' });
}

test('listPlaceLinks returns links ordered newest first', () => {
	const place = seedPlace();
	createPlaceLink(userId, place.id, { label: 'First', url: 'https://first.example' });
	createPlaceLink(userId, place.id, { label: 'Second', url: 'https://second.example' });

	const list = listPlaceLinks(place.id);
	expect(list.map((l) => l.label)).toEqual(['Second', 'First']);
});

test('createPlaceLink inserts a link and audits', () => {
	const place = seedPlace();
	const link = createPlaceLink(userId, place.id, {
		label: 'Booking',
		url: 'https://booking.example/123',
		notes: 'Confirmation ABC'
	});

	expect(link.placeId).toBe(place.id);
	expect(link.label).toBe('Booking');
	expect(link.url).toBe('https://booking.example/123');
	expect(link.notes).toBe('Confirmation ABC');

	const logs = ctx.kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(userId))).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('place_link_create');
	expect(logs[0].entity_type).toBe('place_link');
});

test('createPlaceLink trims whitespace and stores null for blank notes', () => {
	const place = seedPlace();
	const link = createPlaceLink(userId, place.id, {
		label: '  Booking  ',
		url: '  https://booking.example/123  ',
		notes: '   '
	});

	expect(link.label).toBe('Booking');
	expect(link.url).toBe('https://booking.example/123');
	expect(link.notes).toBeNull();
});

test('createPlaceLink rejects non-http(s) and protocol-less URLs', () => {
	const place = seedPlace();
	for (const url of ['javascript:alert(1)', 'ftp://files.example', 'booking.example/123', 'not-a-url']) {
		expect(() => createPlaceLink(userId, place.id, { label: 'X', url })).toThrow(
			expect.objectContaining({ status: 400 })
		);
	}
	expect(listPlaceLinks(place.id)).toHaveLength(0);
});

test('createPlaceLink enforces length caps', () => {
	const place = seedPlace();
	expect(() =>
		createPlaceLink(userId, place.id, { label: 'x'.repeat(201), url: 'https://a.example' })
	).toThrow(expect.objectContaining({ status: 400 }));
	expect(() =>
		createPlaceLink(userId, place.id, {
			label: 'X',
			url: `https://a.example/${'p'.repeat(2000)}`
		})
	).toThrow(expect.objectContaining({ status: 400 }));
	expect(() =>
		createPlaceLink(userId, place.id, {
			label: 'X',
			url: 'https://a.example',
			notes: 'n'.repeat(2001)
		})
	).toThrow(expect.objectContaining({ status: 400 }));
});

test('createPlaceLink rejects another user\'s place (IDOR)', () => {
	const foreign = seedPlace(otherUserId);
	expect(() =>
		createPlaceLink(userId, foreign.id, { label: 'X', url: 'https://a.example' })
	).toThrow(expect.objectContaining({ status: 404 }));
	expect(listPlaceLinks(foreign.id)).toHaveLength(0);
});

test('updatePlaceLink applies a partial patch and audits', () => {
	const place = seedPlace();
	const link = createPlaceLink(userId, place.id, {
		label: 'Old',
		url: 'https://old.example',
		notes: 'Keep me'
	});

	// Label-only patch leaves url and notes untouched.
	const renamed = updatePlaceLink(userId, place.id, link.id, { label: 'New' });
	expect(renamed.label).toBe('New');
	expect(renamed.url).toBe('https://old.example');
	expect(renamed.notes).toBe('Keep me');

	// Explicit null clears notes without touching the other fields.
	const cleared = updatePlaceLink(userId, place.id, link.id, { notes: null });
	expect(cleared.notes).toBeNull();
	expect(cleared.label).toBe('New');

	// URL patches are validated too.
	expect(() =>
		updatePlaceLink(userId, place.id, link.id, { url: 'javascript:alert(1)' })
	).toThrow(expect.objectContaining({ status: 400 }));

	const logs = ctx.kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(userId))).executeSync();
	expect(logs.some((l) => l.action === 'place_link_update')).toBe(true);
});

test('updatePlaceLink rejects another user\'s place and cross-place links', () => {
	const foreign = seedPlace(otherUserId);
	const foreignLink = createPlaceLink(otherUserId, foreign.id, {
		label: 'L',
		url: 'https://a.example'
	});

	// Non-owner cannot patch the link through the place id.
	expect(() =>
		updatePlaceLink(userId, foreign.id, foreignLink.id, { label: 'Hacked' })
	).toThrow(expect.objectContaining({ status: 404 }));

	// The owner cannot reference the link through a different place.
	const own = seedPlace(userId);
	expect(() =>
		updatePlaceLink(userId, own.id, foreignLink.id, { label: 'Hacked' })
	).toThrow(expect.objectContaining({ status: 404 }));

	expect(getPlaceLinkById(foreignLink.id)?.label).toBe('L');
});

test('deletePlaceLink removes only the owned place link', () => {
	const place = seedPlace();
	const link = createPlaceLink(userId, place.id, { label: 'L', url: 'https://a.example' });

	expect(() => deletePlaceLink(otherUserId, place.id, link.id)).toThrow(
		expect.objectContaining({ status: 404 })
	);
	expect(getPlaceLinkById(link.id)).not.toBeNull();

	deletePlaceLink(userId, place.id, link.id);
	expect(getPlaceLinkById(link.id)).toBeNull();

	const logs = ctx.kit.selectFrom(auditLogs).where(eq(auditLogs.user_id, BigInt(userId))).executeSync();
	expect(logs.some((l) => l.action === 'place_link_delete')).toBe(true);
});

test('deleting a place cascades its links', () => {
	const place = seedPlace();
	const link = createPlaceLink(userId, place.id, { label: 'L', url: 'https://a.example' });
	ctx.kit.deleteFrom(places).where(eq(places.id, BigInt(place.id))).executeSync();
	expect(getPlaceLinkById(link.id)).toBeNull();
});
