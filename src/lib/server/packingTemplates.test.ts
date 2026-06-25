import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { saveTemplate, listTemplates, applyTemplate, saveChecklistTemplate, applyChecklistTemplate } from './packingTemplates';
import { users, trips, packingTemplates, packingTemplateItems, tripChecklists, tripChecklistItems, tripShares } from './db/schema';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';

function makeEvent(user: { id: number }, tripId: number, formData: FormData): RequestEvent {
	return {
		locals: { user } as App.Locals,
		params: { id: String(tripId) },
		request: { formData: async () => formData }
	} as RequestEvent;
}

function formData(entries: Record<string, string>): FormData {
	const f = new FormData();
	for (const [key, value] of Object.entries(entries)) {
		f.set(key, value);
	}
	return f;
}

test('saveTemplate creates a template from explicit items', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'pt1@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();

	const id = saveTemplate(u.id, 'Weekend', [
		{ label: 'Toothbrush', category: 'toiletries' },
		{ label: 'Socks', category: 'clothing' }
	]);

	const template = db.select().from(packingTemplates).where(eq(packingTemplates.id, id)).get();
	expect(template?.name).toBe('Weekend');
	expect(template?.userId).toBe(u.id);

	const items = db.select().from(packingTemplateItems).where(eq(packingTemplateItems.templateId, id)).all();
	expect(items.map((i) => ({ label: i.label, category: i.category }))).toEqual([
		{ label: 'Toothbrush', category: 'toiletries' },
		{ label: 'Socks', category: 'clothing' }
	]);
});

test('saveTemplate trims names and defaults blank categories', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'pt2@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();

	const id = saveTemplate(u.id, '  Beach  ', [{ label: '  Sunscreen  ', category: '  ' }]);

	const template = db.select().from(packingTemplates).where(eq(packingTemplates.id, id)).get();
	expect(template?.name).toBe('Beach');
	const items = db.select().from(packingTemplateItems).where(eq(packingTemplateItems.templateId, id)).all();
	expect(items[0]?.label).toBe('Sunscreen');
	expect(items[0]?.category).toBe('general');
});

test('saveTemplate rejects missing name or empty items', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'pt3@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();

	expect(() => saveTemplate(u.id, '', [{ label: 'X' }])).toThrow();
	expect(() => saveTemplate(u.id, 'Name', [])).toThrow();
});

test('saveTemplate populates from a trip checklist', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'pt4@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const checklist = db.insert(tripChecklists).values({ tripId: t.id }).returning().get();
	db.insert(tripChecklistItems)
		.values([
			{ checklistId: checklist.id, text: 'Boarding pass' },
			{ checklistId: checklist.id, text: 'Passport' }
		])
		.run();

	const id = saveTemplate(u.id, 'Flight', [], t.id);

	const items = db.select().from(packingTemplateItems).where(eq(packingTemplateItems.templateId, id)).all();
	expect(items.map((i) => i.label)).toEqual(['Boarding pass', 'Passport']);
});

test('saveTemplate requires editable trip when populating from trip', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db.insert(users).values({ email: 'pt5-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'pt5-b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();

	expect(() => saveTemplate(b.id, 'Stolen', [], t.id)).toThrow();
});

test('listTemplates returns templates scoped to user with items', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db.insert(users).values({ email: 'pt6-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'pt6-b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const idA = saveTemplate(a.id, 'A-list', [{ label: 'A1' }]);
	saveTemplate(b.id, 'B-list', [{ label: 'B1' }]);

	const list = listTemplates(a.id);
	expect(list).toHaveLength(1);
	expect(list[0]?.name).toBe('A-list');
	expect(list[0]?.items).toHaveLength(1);
	expect(list[0]?.items[0]?.label).toBe('A1');
	expect(list[0]?.items[0]?.category).toBe('general');

	const reloaded = db.select().from(packingTemplates).where(eq(packingTemplates.id, idA)).get();
	expect(reloaded?.name).toBe('A-list');
});

test('applyTemplate copies template items to trip checklist', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'pt7@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const templateId = saveTemplate(u.id, 'Camping', [
		{ label: 'Tent', category: 'gear' },
		{ label: 'Stove', category: 'gear' }
	]);

	const result = applyTemplate(templateId, t.id, u.id);
	expect(result.itemCount).toBe(2);

	const checklist = db.select().from(tripChecklists).where(eq(tripChecklists.tripId, t.id)).get();
	expect(checklist).toBeDefined();
	const items = db
		.select()
		.from(tripChecklistItems)
		.where(eq(tripChecklistItems.checklistId, checklist!.id))
		.all();
	expect(items.map((i) => i.text)).toEqual(['Tent', 'Stove']);
});

test('applyTemplate guards against non-editable trips', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db.insert(users).values({ email: 'pt8-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'pt8-b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const templateId = saveTemplate(a.id, 'Mine', [{ label: 'X' }]);

	expect(() => applyTemplate(templateId, t.id, b.id)).toThrow();
});

test('applyTemplate guards templates owned by another user', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db.insert(users).values({ email: 'pt9-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'pt9-b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = db.insert(trips).values({ ownerId: b.id, name: 'T' }).returning().get();
	const templateId = saveTemplate(a.id, 'Mine', [{ label: 'X' }]);

	expect(() => applyTemplate(templateId, t.id, b.id)).toThrow();
});

test('applyTemplate allows editor shared with edit permission', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db.insert(users).values({ email: 'pt10-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'pt10-b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	db.insert(tripShares)
		.values({ tripId: t.id, sharedWithUserId: b.id, permission: 'edit' })
		.run();
	const templateId = saveTemplate(b.id, 'Shared', [{ label: 'X' }]);

	applyTemplate(templateId, t.id, b.id);

	const checklist = db.select().from(tripChecklists).where(eq(tripChecklists.tripId, t.id)).get();
	const items = db
		.select()
		.from(tripChecklistItems)
		.where(eq(tripChecklistItems.checklistId, checklist!.id))
		.all();
	expect(items.map((i) => i.text)).toEqual(['X']);
});

test('saveChecklistTemplate action saves current checklist as template and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'pt11@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const checklist = db.insert(tripChecklists).values({ tripId: t.id }).returning().get();
	db.insert(tripChecklistItems).values({ checklistId: checklist.id, text: 'Charger' }).run();

	await expect(
		saveChecklistTemplate(
			makeEvent(u, t.id, formData({ name: 'Electronics', fromTripId: String(t.id) }))
		)
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const saved = listTemplates(u.id);
	expect(saved).toHaveLength(1);
	expect(saved[0]?.items.map((i) => i.label)).toEqual(['Charger']);
});

test('applyChecklistTemplate action applies a template and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'pt12@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const templateId = saveTemplate(u.id, 'Kit', [{ label: 'Map' }]);

	await expect(
		applyChecklistTemplate(makeEvent(u, t.id, formData({ templateId: String(templateId) })))
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const checklist = db.select().from(tripChecklists).where(eq(tripChecklists.tripId, t.id)).get();
	const items = db
		.select()
		.from(tripChecklistItems)
		.where(eq(tripChecklistItems.checklistId, checklist!.id))
		.all();
	expect(items.map((i) => i.text)).toEqual(['Map']);
});

test('applyChecklistTemplate action rejects invalid template id', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'pt13@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	await expect(
		applyChecklistTemplate(makeEvent(u, t.id, formData({ templateId: 'abc' })))
	).rejects.toMatchObject({ status: 400 });
});
