import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	addEntryRequirement,
	deleteEntryRequirement,
	listEntryRequirements,
	updateEntryRequirementStatus
} from './tripEntryRequirements';
import { tripEntryRequirements, trips, users } from './db/mongrelSchema';
import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeSyncedUser, makeSyncedTrip } from '../../../tests/helpers';

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

beforeEach(() => {
	const kit = getKit();
	kit.deleteFrom(tripEntryRequirements).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

function seed() {
	const kit = getKit();
	const u = makeSyncedUser(kit, { email: 'er@x.c' });
	const t = makeSyncedTrip(kit, { ownerId: u.id, name: 'T' });
	const other = makeSyncedUser(kit, { email: 'oth@x.c' });
	return { kit, u, t, other };
}

test('addEntryRequirement creates a visa requirement', () => {
	const { kit, u, t } = seed();
	const req = addEntryRequirement(u.id, t.id, {
		country: 'France',
		requirementType: 'visa',
		status: 'needed',
		dueDate: '2026-06-01',
		notes: 'Apply online'
	});
	expect(req.country).toBe('France');
	expect(req.status).toBe('needed');

	const rows = listEntryRequirements(t.id);
	expect(rows).toHaveLength(1);
	expect(
		kit.selectFrom(tripEntryRequirements).where(eq(tripEntryRequirements.id, BigInt(req.id))).executeSync()[0]
	).toBeTruthy();
});

test('addEntryRequirement defaults status to needed', () => {
	const { u, t } = seed();
	const req = addEntryRequirement(u.id, t.id, { country: 'Brazil', requirementType: 'vaccination' });
	expect(req.status).toBe('needed');
});

test('addEntryRequirement validates type and country', () => {
	const { u, t } = seed();
	expect(() => addEntryRequirement(u.id, t.id, { country: '', requirementType: 'visa' })).toThrow();
	expect(() =>
		addEntryRequirement(u.id, t.id, { country: 'X', requirementType: 'invalid' })
	).toThrowError(expect.objectContaining({ status: 400 }));
});

test('updateEntryRequirementStatus changes status', () => {
	const { u, t } = seed();
	const req = addEntryRequirement(u.id, t.id, { country: 'China', requirementType: 'visa' });
	const updated = updateEntryRequirementStatus(u.id, t.id, req.id, { status: 'complete' });
	expect(updated.status).toBe('complete');
	expect(listEntryRequirements(t.id)[0].status).toBe('complete');
});

test('updateEntryRequirementStatus rejects invalid status', () => {
	const { u, t } = seed();
	const req = addEntryRequirement(u.id, t.id, { country: 'X', requirementType: 'other' });
	expect(() => updateEntryRequirementStatus(u.id, t.id, req.id, { status: 'nope' })).toThrow();
});

test('deleteEntryRequirement removes the row', () => {
	const { kit, u, t } = seed();
	const req = addEntryRequirement(u.id, t.id, { country: 'Y', requirementType: 'other' });
	deleteEntryRequirement(u.id, t.id, req.id);
	expect(
		kit.selectFrom(tripEntryRequirements).where(eq(tripEntryRequirements.id, BigInt(req.id))).executeSync()[0]
	).toBeUndefined();
});

test('non-editor cannot mutate entry requirements', () => {
	const { u, t, other } = seed();
	const req = addEntryRequirement(u.id, t.id, { country: 'Z', requirementType: 'other' });
	expect(() => addEntryRequirement(other.id, t.id, { country: 'A', requirementType: 'other' })).toThrow();
	expect(() => updateEntryRequirementStatus(other.id, t.id, req.id, { status: 'complete' })).toThrow();
	expect(() => deleteEntryRequirement(other.id, t.id, req.id)).toThrow();
});
