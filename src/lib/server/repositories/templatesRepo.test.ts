import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import * as templatesRepo from './templatesRepo';
import * as usersRepo from './usersRepo';
import * as tripsRepo from './tripsRepo';
import {
	users,
	trips,
	tripTemplates,
	packingTemplates,
	packingTemplateItems
} from '$lib/server/db/schema';
import {
	users as kitUsers,
	trips as kitTrips,
	tripTemplates as kitTripTemplates,
	packingTemplates as kitPackingTemplates,
	packingTemplateItems as kitPackingTemplateItems
} from '$lib/server/db/mongrelSchema';
import { eq } from 'drizzle-orm';

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
	return tripsRepo.createTrip(ownerId, {
		name,
		archived: false,
		startDate: null,
		endDate: null
	});
}

beforeEach(() => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	db.delete(packingTemplateItems).run();
	db.delete(packingTemplates).run();
	db.delete(tripTemplates).run();
	db.delete(trips).run();
	db.delete(users).run();
	kit.deleteFrom(kitPackingTemplateItems).executeSync();
	kit.deleteFrom(kitPackingTemplates).executeSync();
	kit.deleteFrom(kitTripTemplates).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
});

// Trip templates

test('createTripTemplate stores snapshot and source trip', () => {
	const u = makeUser('ttr1@x.c');
	const t = makeTrip(Number(u.id), 'Source');

	const tpl = templatesRepo.createTripTemplate({
		userId: Number(u.id),
		sourceTripId: t.id,
		name: 'Weekend',
		snapshot: { name: 'Source', tags: ['demo'] }
	});

	expect(tpl.name).toBe('Weekend');
	expect(tpl.userId).toBe(Number(u.id));
	expect(tpl.sourceTripId).toBe(t.id);
	expect(tpl.snapshot).toEqual({ name: 'Source', tags: ['demo'] });
});

test('listTripTemplates returns only the users templates', () => {
	const a = makeUser('ttr2-a@x.c');
	const b = makeUser('ttr2-b@x.c');

	templatesRepo.createTripTemplate({ userId: Number(a.id), name: 'A', snapshot: {} });
	templatesRepo.createTripTemplate({ userId: Number(b.id), name: 'B', snapshot: {} });

	const list = templatesRepo.listTripTemplates(Number(a.id));
	expect(list).toHaveLength(1);
	expect(list[0].name).toBe('A');
});

test('deleteTripTemplate removes the template', () => {
	const u = makeUser('ttr3@x.c');
	const tpl = templatesRepo.createTripTemplate({ userId: Number(u.id), name: 'Gone', snapshot: {} });

	expect(templatesRepo.deleteTripTemplate(tpl.id)).toBe(1);
	expect(templatesRepo.getTripTemplateById(tpl.id)).toBeNull();
});

// Packing templates

test('createPackingTemplate creates a template and items', () => {
	const u = makeUser('ptr1@x.c');

	const tpl = templatesRepo.createPackingTemplate({ userId: Number(u.id), name: 'Beach' });
	templatesRepo.createPackingTemplateItem({ templateId: tpl.id, label: 'Sunscreen', category: 'toiletries' });
	templatesRepo.createPackingTemplateItem({ templateId: tpl.id, label: 'Towel' });

	const loaded = templatesRepo.getPackingTemplateById(tpl.id)!;
	expect(loaded.name).toBe('Beach');
	expect(loaded.items).toHaveLength(2);
	expect(loaded.items.map((i) => ({ label: i.label, category: i.category }))).toEqual([
		{ label: 'Sunscreen', category: 'toiletries' },
		{ label: 'Towel', category: 'general' }
	]);
});

test('listPackingTemplates includes items sorted by creation', () => {
	const u = makeUser('ptr2@x.c');

	const tpl = templatesRepo.createPackingTemplate({ userId: Number(u.id), name: 'Camping' });
	templatesRepo.createPackingTemplateItem({ templateId: tpl.id, label: 'Tent' });
	templatesRepo.createPackingTemplateItem({ templateId: tpl.id, label: 'Stove' });

	const list = templatesRepo.listPackingTemplates(Number(u.id));
	expect(list).toHaveLength(1);
	expect(list[0].items.map((i) => i.label)).toEqual(['Tent', 'Stove']);
});

test('updatePackingTemplate renames a template', () => {
	const u = makeUser('ptr3@x.c');
	const tpl = templatesRepo.createPackingTemplate({ userId: Number(u.id), name: 'Old' });

	const updated = templatesRepo.updatePackingTemplate(tpl.id, { name: 'New' });
	expect(updated?.name).toBe('New');
});

test('deletePackingTemplate cascades items', () => {
	const u = makeUser('ptr4@x.c');
	const tpl = templatesRepo.createPackingTemplate({ userId: Number(u.id), name: 'Gone' });
	templatesRepo.createPackingTemplateItem({ templateId: tpl.id, label: 'X' });

	expect(templatesRepo.deletePackingTemplate(tpl.id)).toBe(1);
	expect(templatesRepo.getPackingTemplateById(tpl.id)).toBeNull();
	expect(templatesRepo.listPackingTemplateItems(tpl.id)).toHaveLength(0);
});

test('updatePackingTemplateItem changes label and category', () => {
	const u = makeUser('ptr5@x.c');
	const tpl = templatesRepo.createPackingTemplate({ userId: Number(u.id), name: 'T' });
	const item = templatesRepo.createPackingTemplateItem({ templateId: tpl.id, label: 'Old' });

	const updated = templatesRepo.updatePackingTemplateItem(item.id, { label: 'New', category: 'gear' });
	expect(updated?.label).toBe('New');
	expect(updated?.category).toBe('gear');
});

test('deletePackingTemplateItem removes a single item', () => {
	const u = makeUser('ptr6@x.c');
	const tpl = templatesRepo.createPackingTemplate({ userId: Number(u.id), name: 'T' });
	const item = templatesRepo.createPackingTemplateItem({ templateId: tpl.id, label: 'X' });

	expect(templatesRepo.deletePackingTemplateItem(item.id)).toBe(1);
	expect(templatesRepo.listPackingTemplateItems(tpl.id)).toHaveLength(0);
});

test('legacy tables stay in sync with kit writes', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser('ttr4@x.c');

	const tripTpl = templatesRepo.createTripTemplate({
		userId: Number(u.id),
		name: 'Legacy trip template',
		snapshot: { key: 'value' }
	});
	const legacyTripTpl = db
		.select()
		.from(tripTemplates)
		.where(eq(tripTemplates.id, tripTpl.id))
		.get();
	expect(legacyTripTpl?.name).toBe('Legacy trip template');
	expect(legacyTripTpl?.snapshotJson).toContain('value');

	const packTpl = templatesRepo.createPackingTemplate({ userId: Number(u.id), name: 'Legacy packing' });
	templatesRepo.createPackingTemplateItem({ templateId: packTpl.id, label: 'Item' });
	const legacyPackTpl = db
		.select()
		.from(packingTemplates)
		.where(eq(packingTemplates.id, packTpl.id))
		.get();
	expect(legacyPackTpl?.name).toBe('Legacy packing');
	const legacyItems = db
		.select()
		.from(packingTemplateItems)
		.where(eq(packingTemplateItems.templateId, packTpl.id))
		.all();
	expect(legacyItems).toHaveLength(1);
});
