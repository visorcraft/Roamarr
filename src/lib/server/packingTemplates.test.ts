import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { saveTemplate, listTemplates, applyTemplate, saveChecklistTemplate, applyChecklistTemplate } from './packingTemplates';
import {
	users,
	trips,
	packingTemplates,
	packingTemplateItems,
	tripChecklists,
	tripChecklistItems,
	tripShares
} from './db/schema';
import { trips as kitTrips, users as kitUsers, packingTemplates as kitPackingTemplates } from './db/mongrelSchema';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { makeFormData } from '../../../tests/eventHelpers';
import * as usersRepo from './repositories/usersRepo';
import * as tripsRepo from './repositories/tripsRepo';

function makeEvent(user: { id: number }, tripId: number, formData: FormData): RequestEvent {
	return {
		locals: { user } as App.Locals,
		params: { id: String(tripId) },
		request: { formData: async () => formData }
	} as RequestEvent;
}

function makeUser(email: string) {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: email,
		calendar_token: null,
		calendar_token_expires_at: null
	});
}

function makeTrip(ownerId: number, name: string) {
	return tripsRepo.createTrip(ownerId, { name });
}

beforeEach(() => {
	const db = (ctx as { db: import('./db').DB }).db;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	db.delete(tripChecklistItems).run();
	db.delete(tripChecklists).run();
	db.delete(packingTemplateItems).run();
	db.delete(packingTemplates).run();
	db.delete(tripShares).run();
	db.delete(trips).run();
	db.delete(users).run();
	kit.deleteFrom(kitPackingTemplates).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
});

test('saveTemplate creates a template from explicit items', () => {
	const u = makeUser('pt1@x.c');

	const id = saveTemplate(Number(u.id), 'Weekend', [
		{ label: 'Toothbrush', category: 'toiletries' },
		{ label: 'Socks', category: 'clothing' }
	]);

	const db = (ctx as { db: import('./db').DB }).db;
	const template = db.select().from(packingTemplates).where(eq(packingTemplates.id, id)).get();
	expect(template?.name).toBe('Weekend');
	expect(template?.userId).toBe(Number(u.id));

	const items = db.select().from(packingTemplateItems).where(eq(packingTemplateItems.templateId, id)).all();
	expect(items.map((i: Record<string, unknown>) => ({ label: i.label, category: i.category }))).toEqual([
		{ label: 'Toothbrush', category: 'toiletries' },
		{ label: 'Socks', category: 'clothing' }
	]);
});

test('saveTemplate trims names and defaults blank categories', () => {
	const u = makeUser('pt2@x.c');

	const id = saveTemplate(Number(u.id), '  Beach  ', [{ label: '  Sunscreen  ', category: '  ' }]);

	const db = (ctx as { db: import('./db').DB }).db;
	const template = db.select().from(packingTemplates).where(eq(packingTemplates.id, id)).get();
	expect(template?.name).toBe('Beach');
	const items = db.select().from(packingTemplateItems).where(eq(packingTemplateItems.templateId, id)).all();
	expect(items[0]?.label).toBe('Sunscreen');
	expect(items[0]?.category).toBe('general');
});

test('saveTemplate rejects missing name or empty items', () => {
	const u = makeUser('pt3@x.c');

	expect(() => saveTemplate(Number(u.id), '', [{ label: 'X' }])).toThrow();
	expect(() => saveTemplate(Number(u.id), 'Name', [])).toThrow();
});

test('saveTemplate populates from a trip checklist', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser('pt4@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const checklist = db.insert(tripChecklists).values({ tripId: t.id }).returning().get();
	db.insert(tripChecklistItems)
		.values([
			{ checklistId: checklist.id, text: 'Boarding pass' },
			{ checklistId: checklist.id, text: 'Passport' }
		])
		.run();

	const id = saveTemplate(Number(u.id), 'Flight', [], t.id);

	const items = db.select().from(packingTemplateItems).where(eq(packingTemplateItems.templateId, id)).all();
	expect(items.map((i: Record<string, unknown>) => i.label)).toEqual(['Boarding pass', 'Passport']);
});

test('saveTemplate requires editable trip when populating from trip', () => {
	const a = makeUser('pt5-a@x.c');
	const b = makeUser('pt5-b@x.c');
	const t = makeTrip(Number(a.id), 'T');

	expect(() => saveTemplate(Number(b.id), 'Stolen', [], t.id)).toThrow();
});

test('listTemplates returns templates scoped to user with items', () => {
	const a = makeUser('pt6-a@x.c');
	const b = makeUser('pt6-b@x.c');
	const idA = saveTemplate(Number(a.id), 'A-list', [{ label: 'A1' }]);
	saveTemplate(Number(b.id), 'B-list', [{ label: 'B1' }]);

	const list = listTemplates(Number(a.id));
	expect(list).toHaveLength(1);
	expect(list[0]?.name).toBe('A-list');
	expect(list[0]?.items).toHaveLength(1);
	expect(list[0]?.items[0]?.label).toBe('A1');
	expect(list[0]?.items[0]?.category).toBe('general');

	const db = (ctx as { db: import('./db').DB }).db;
	const reloaded = db.select().from(packingTemplates).where(eq(packingTemplates.id, idA)).get();
	expect(reloaded?.name).toBe('A-list');
});

test('applyTemplate copies template items to trip checklist', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser('pt7@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const templateId = saveTemplate(Number(u.id), 'Camping', [
		{ label: 'Tent', category: 'gear' },
		{ label: 'Stove', category: 'gear' }
	]);

	const result = applyTemplate(templateId, t.id, Number(u.id));
	expect(result.itemCount).toBe(2);

	const checklist = db.select().from(tripChecklists).where(eq(tripChecklists.tripId, t.id)).get();
	expect(checklist).toBeDefined();
	const items = db
		.select()
		.from(tripChecklistItems)
		.where(eq(tripChecklistItems.checklistId, checklist!.id))
		.all();
	expect(items.map((i: Record<string, unknown>) => i.text)).toEqual(['Tent', 'Stove']);
});

test('applyTemplate guards against non-editable trips', () => {
	const a = makeUser('pt8-a@x.c');
	const b = makeUser('pt8-b@x.c');
	const t = makeTrip(Number(a.id), 'T');
	const templateId = saveTemplate(Number(a.id), 'Mine', [{ label: 'X' }]);

	expect(() => applyTemplate(templateId, t.id, Number(b.id))).toThrow();
});

test('applyTemplate guards templates owned by another user', () => {
	const a = makeUser('pt9-a@x.c');
	const b = makeUser('pt9-b@x.c');
	const t = makeTrip(Number(b.id), 'T');
	const templateId = saveTemplate(Number(a.id), 'Mine', [{ label: 'X' }]);

	expect(() => applyTemplate(templateId, t.id, Number(b.id))).toThrow();
});

test('applyTemplate allows editor shared with edit permission', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = makeUser('pt10-a@x.c');
	const b = makeUser('pt10-b@x.c');
	const t = makeTrip(Number(a.id), 'T');
	db.insert(tripShares)
		.values({ tripId: t.id, sharedWithUserId: Number(b.id), permission: 'edit' })
		.run();
	const templateId = saveTemplate(Number(b.id), 'Shared', [{ label: 'X' }]);

	applyTemplate(templateId, t.id, Number(b.id));

	const checklist = db.select().from(tripChecklists).where(eq(tripChecklists.tripId, t.id)).get();
	const items = db
		.select()
		.from(tripChecklistItems)
		.where(eq(tripChecklistItems.checklistId, checklist!.id))
		.all();
	expect(items.map((i: Record<string, unknown>) => i.text)).toEqual(['X']);
});

test('saveChecklistTemplate action saves current checklist as template and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = makeUser('pt11@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const checklist = db.insert(tripChecklists).values({ tripId: t.id }).returning().get();
	db.insert(tripChecklistItems).values({ checklistId: checklist.id, text: 'Charger' }).run();

	await expect(
		saveChecklistTemplate(
			makeEvent({ id: Number(u.id) }, t.id, makeFormData({ name: 'Electronics', fromTripId: String(t.id) }))
		)
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const saved = listTemplates(Number(u.id));
	expect(saved).toHaveLength(1);
	expect(saved[0]?.items.map((i) => i.label)).toEqual(['Charger']);
});

test('applyChecklistTemplate action applies a template and redirects', async () => {
	const u = makeUser('pt12@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const templateId = saveTemplate(Number(u.id), 'Kit', [{ label: 'Map' }]);

	await expect(
		applyChecklistTemplate(makeEvent({ id: Number(u.id) }, t.id, makeFormData({ templateId: String(templateId) })))
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const db = (ctx as { db: import('./db').DB }).db;
	const checklist = db.select().from(tripChecklists).where(eq(tripChecklists.tripId, t.id)).get();
	const items = db
		.select()
		.from(tripChecklistItems)
		.where(eq(tripChecklistItems.checklistId, checklist!.id))
		.all();
	expect(items.map((i: Record<string, unknown>) => i.text)).toEqual(['Map']);
});

test('applyChecklistTemplate action rejects invalid template id', async () => {
	const u = makeUser('pt13@x.c');
	const t = makeTrip(Number(u.id), 'T');

	await expect(
		applyChecklistTemplate(makeEvent({ id: Number(u.id) }, t.id, makeFormData({ templateId: 'abc' })))
	).rejects.toMatchObject({ status: 400 });
});
