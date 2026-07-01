import { test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { type KitDatabase } from '@visorcraft/mongreldb-kit';
import { canView, canEdit, canViewDetails, viewerProjection, listViewableTrips } from './sharing';
import { segments } from './db/mongrelSchema';
import * as usersRepo from './repositories/usersRepo';
import * as tripsRepo from './repositories/tripsRepo';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeUser(email: string) {
	const u = usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: email,
		calendar_token: null,
		calendar_token_expires_at: null
	});
	return { ...u, id: Number(u.id) };
}

function makeTrip(ownerId: number, name: string) {
	return tripsRepo.createTrip(ownerId, { name, calendarToken: randomUUID() });
}

test('view matrix + projection omits sensitive fields', () => {
	const a = makeUser('a@x.c');
	const b = makeUser('b@x.c');
	const c = makeUser('c@x.c');
	const t = makeTrip(a.id, 'T');
	tripsRepo.createShare({ tripId: t.id, sharedWithUserId: b.id });
	const g = tripsRepo.createGroup({ ownerId: a.id, name: 'fam' });
	tripsRepo.addGroupMember(g.id, c.id);
	tripsRepo.createShare({ tripId: t.id, sharedWithGroupId: g.id });

	expect(canView(a.id, t)).toBe(true);
	expect(canView(b.id, t)).toBe(true);
	expect(canView(c.id, t)).toBe(true);
	expect(canView(999, t)).toBe(false);
	expect(canEdit(b.id, t)).toBe(false);
	expect(canEdit(c.id, t)).toBe(false);

	const proj = viewerProjection(t, [
		{
			type: 'flight',
			title: 'UA1',
			startAt: '2026-07-01T15:00:00Z',
			endAt: null,
			location: 'JFK',
			confirmationNumber: 'X',
			detailsJson: null
		} as any
	]);
	expect(JSON.stringify(proj)).not.toContain('CONF ABC123');
	expect(JSON.stringify(proj)).not.toContain('"confirmationNumber"');
});

test('edit shares grant canEdit via user and group', () => {
	const owner = makeUser('edit-owner@x.c');
	const userEditor = makeUser('edit-user@x.c');
	const groupEditor = makeUser('edit-group@x.c');
	const reader = makeUser('edit-reader@x.c');
	const t = makeTrip(owner.id, 'T');

	tripsRepo.createShare({ tripId: t.id, sharedWithUserId: userEditor.id, permission: 'edit' });
	tripsRepo.createShare({ tripId: t.id, sharedWithUserId: reader.id, permission: 'read' });

	const grp = tripsRepo.createGroup({ ownerId: owner.id, name: 'editors' });
	tripsRepo.addGroupMember(grp.id, groupEditor.id);
	tripsRepo.createShare({ tripId: t.id, sharedWithGroupId: grp.id, permission: 'edit' });

	expect(canEdit(owner.id, t)).toBe(true);
	expect(canEdit(userEditor.id, t)).toBe(true);
	expect(canEdit(groupEditor.id, t)).toBe(true);
	expect(canEdit(reader.id, t)).toBe(false);
	expect(canEdit(999, t)).toBe(false);
	expect(canView(reader.id, t)).toBe(true);
});

test('showDetails gate exposes confirmation numbers and details only when enabled', () => {
	const owner = makeUser('details-owner@x.c');
	const reader = makeUser('details-reader@x.c');
	const groupMember = makeUser('details-member@x.c');
	const t = makeTrip(owner.id, 'T');

	const seg = {
		type: 'flight',
		title: 'UA1',
		startAt: '2026-07-01T15:00:00Z',
		endAt: null,
		location: 'JFK',
		confirmationNumber: 'CONF123',
		detailsJson: '{"seat":"12A"}'
	} as any;

	const withoutDetails = viewerProjection(t, [seg]);
	expect(JSON.stringify(withoutDetails)).not.toContain('CONF123');
	expect(JSON.stringify(withoutDetails)).not.toContain('12A');

	const withDetails = viewerProjection(t, [seg], true);
	expect(JSON.stringify(withDetails)).toContain('CONF123');
	expect(JSON.stringify(withDetails)).toContain('12A');

	expect(canViewDetails(owner.id, t)).toBe(true);

	const share = tripsRepo.createShare({ tripId: t.id, sharedWithUserId: reader.id, showDetails: false });
	expect(canViewDetails(reader.id, t)).toBe(false);
	tripsRepo.updateShare(share.id, { showDetails: true });
	expect(canViewDetails(reader.id, t)).toBe(true);

	const g = tripsRepo.createGroup({ ownerId: owner.id, name: 'details-fam' });
	tripsRepo.addGroupMember(g.id, groupMember.id);
	tripsRepo.createShare({ tripId: t.id, sharedWithGroupId: g.id, showDetails: true });
	expect(canViewDetails(groupMember.id, t)).toBe(true);
});

test('listViewableTrips searches segment titles and confirmation numbers for owners', () => {
	const kit = kitDb();
	const owner = makeUser('search@x.c');
	const t = makeTrip(owner.id, 'Trip');
	kit.insertInto(segments).values({
		trip_id: BigInt(t.id),
		type: 'flight',
		title: 'Delta 15',
		start_at: '2026-07-01T15:00:00Z',
		confirmation_number: 'ABC999'
	}).executeSync();

	expect(listViewableTrips(owner.id, { q: 'Delta' })).toHaveLength(1);
	expect(listViewableTrips(owner.id, { q: 'ABC999' })).toHaveLength(1);
	expect(listViewableTrips(owner.id, { q: 'nowhere' })).toHaveLength(0);
});
