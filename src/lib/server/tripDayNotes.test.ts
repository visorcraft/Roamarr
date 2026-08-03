import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	listDayNotes,
	getDayNote,
	setDayNote,
	deleteDayNote,
	setDayNoteAction,
	deleteDayNoteAction
} from './tripDayNotes';
import { viewerProjection } from './sharing';
import { tripShares, auditLogs } from './db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import type { RequestEvent } from '@sveltejs/kit';
import { makeSyncedUser, makeSyncedTrip } from '../../../tests/helpers';
import * as tripsRepo from './repositories/tripsRepo';

function getKit() {
	return (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
}

function makeEvent(
	user: { id: number; email: string },
	params: Record<string, string>,
	values: Record<string, string>
): RequestEvent {
	const form = new FormData();
	for (const [key, value] of Object.entries(values)) {
		form.append(key, value);
	}
	return {
		locals: { user } as App.Locals,
		params,
		request: { formData: async () => form } as unknown as Request
	} as RequestEvent;
}

function shareTrip(tripId: number, userId: number, permission: 'read' | 'edit') {
	getKit()
		.insertInto(tripShares)
		.values({
			trip_id: BigInt(tripId),
			shared_with_user_id: BigInt(userId),
			permission
		} as never)
		.executeSync();
}

test('setDayNote creates a note and logs audit', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dn1@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const note = setDayNote(u.id, t.id, '2026-06-10', { icon: 'star', body: 'Museum day' });
	expect(note.tripId).toBe(t.id);
	expect(note.date).toBe('2026-06-10');
	expect(note.icon).toBe('star');
	expect(note.body).toBe('Museum day');

	const audit = kit
		.selectFrom(auditLogs)
		.where(eq(auditLogs.entity_id, BigInt(note.id)))
		.executeSync()[0];
	expect(audit?.action).toBe('create');
	expect(audit?.entity_type).toBe('trip_day_note');
});

test('setDayNote upserts per (trip, date)', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dn2@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const first = setDayNote(u.id, t.id, '2026-06-10', { icon: 'star', body: 'First' });
	const second = setDayNote(u.id, t.id, '2026-06-10', { icon: 'info', body: 'Updated' });
	expect(second.id).toBe(first.id);
	expect(second.body).toBe('Updated');
	expect(second.icon).toBe('info');
	expect(listDayNotes(u.id, t.id)).toHaveLength(1);
	// A different day is a separate note.
	setDayNote(u.id, t.id, '2026-06-11', { body: 'Other day' });
	expect(listDayNotes(u.id, t.id)).toHaveLength(2);
});

test('setDayNote can change and clear the icon', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dn3@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	setDayNote(u.id, t.id, '2026-06-10', { icon: 'warning', body: 'B' });
	const cleared = setDayNote(u.id, t.id, '2026-06-10', { icon: null, body: 'B2' });
	expect(cleared.icon).toBeNull();
	expect(cleared.body).toBe('B2');
	const again = setDayNote(u.id, t.id, '2026-06-10', { body: 'B3' });
	expect(again.icon).toBeNull();
});

test('setDayNote rejects over-long bodies, bad dates, and unknown icons', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dn4@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	expect(() => setDayNote(u.id, t.id, '2026-06-10', { body: 'x'.repeat(10001) })).toThrow();
	expect(() => setDayNote(u.id, t.id, '2026-06-10', { body: '' })).toThrow();
	expect(() => setDayNote(u.id, t.id, '10/06/2026', { body: 'B' })).toThrow();
	expect(() => setDayNote(u.id, t.id, '2026-06-10', { icon: 'nope', body: 'B' })).toThrow();
	expect(listDayNotes(u.id, t.id)).toHaveLength(0);
});

test('listDayNotes sorts by date and getDayNote fetches one day', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dn5@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	setDayNote(u.id, t.id, '2026-06-12', { body: 'Later' });
	setDayNote(u.id, t.id, '2026-06-10', { body: 'Earlier' });
	expect(listDayNotes(u.id, t.id).map((n) => n.date)).toEqual(['2026-06-10', '2026-06-12']);
	expect(getDayNote(u.id, t.id, '2026-06-12')?.body).toBe('Later');
	expect(getDayNote(u.id, t.id, '2026-06-13')).toBeNull();
});

test('authorization: edit-share can write, read-share can only read, stranger gets nothing', () => {
	const kit = getKit();
	const owner = makeSyncedUser(kit, { email: 'dn6-owner@x.c' });
	const editor = makeSyncedUser(kit, { email: 'dn6-editor@x.c' });
	const viewer = makeSyncedUser(kit, { email: 'dn6-viewer@x.c' });
	const stranger = makeSyncedUser(kit, { email: 'dn6-stranger@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: owner.id, name: 'T' });
	shareTrip(t.id, editor.id, 'edit');
	shareTrip(t.id, viewer.id, 'read');

	const note = setDayNote(editor.id, t.id, '2026-06-10', { body: 'Editor note' });
	expect(note.body).toBe('Editor note');

	expect(listDayNotes(viewer.id, t.id)).toHaveLength(1);
	expect(getDayNote(viewer.id, t.id, '2026-06-10')?.body).toBe('Editor note');
	expect(() => setDayNote(viewer.id, t.id, '2026-06-10', { body: 'Hacked' })).toThrow();
	expect(() => deleteDayNote(viewer.id, t.id, '2026-06-10')).toThrow();

	expect(() => listDayNotes(stranger.id, t.id)).toThrow();
	expect(() => getDayNote(stranger.id, t.id, '2026-06-10')).toThrow();
	expect(() => setDayNote(stranger.id, t.id, '2026-06-10', { body: 'Hacked' })).toThrow();
	expect(() => deleteDayNote(stranger.id, t.id, '2026-06-10')).toThrow();
});

test('deleteDayNote removes the note and logs audit', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dn7@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const note = setDayNote(u.id, t.id, '2026-06-10', { body: 'Gone soon' });
	deleteDayNote(u.id, t.id, '2026-06-10');
	expect(listDayNotes(u.id, t.id)).toHaveLength(0);
	expect(() => deleteDayNote(u.id, t.id, '2026-06-10')).toThrow();
	const audit = kit
		.selectFrom(auditLogs)
		.where(eq(auditLogs.entity_id, BigInt(note.id)))
		.executeSync()
		.find((a) => a.action === 'delete');
	expect(audit).toBeDefined();
});

test('viewerProjection never includes day notes', () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dn8@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	setDayNote(u.id, t.id, '2026-06-10', { body: 'Private note' });
	const trip = tripsRepo.getTripById(t.id)!;
	const projection = viewerProjection(trip, [], true) as Record<string, unknown>;
	expect(JSON.stringify(projection)).not.toContain('Private note');
	expect('dayNotes' in projection).toBe(false);
});

test('setDayNoteAction validates and redirects', async () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dn9@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const event = makeEvent(u, { id: String(t.id) }, {
		date: '2026-06-20',
		icon: 'info',
		body: 'Action note'
	});
	await expect(setDayNoteAction(event)).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(getDayNote(u.id, t.id, '2026-06-20')?.body).toBe('Action note');
});

test('setDayNoteAction returns fail for invalid input', async () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dn10@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const event = makeEvent(u, { id: String(t.id) }, { date: '', body: '' });
	const result = await setDayNoteAction(event);
	expect(result?.status).toBe(400);
});

test('deleteDayNoteAction deletes and redirects', async () => {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'dn11@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	setDayNote(u.id, t.id, '2026-06-20', { body: 'Delete me' });
	const event = makeEvent(u, { id: String(t.id) }, { date: '2026-06-20' });
	await expect(deleteDayNoteAction(event)).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});
	expect(listDayNotes(u.id, t.id)).toHaveLength(0);
});
