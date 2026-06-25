import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db, sqlite } from './db';
import { packingTemplates, packingTemplateItems, tripChecklists, tripChecklistItems } from './db/schema';
import { getOrCreateChecklist } from './tripChecklists';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { Validator } from './validation';
import { parseTripId } from './params';

const TEMPLATE_NAME_MAX = 100;
const ITEM_LABEL_MAX = 200;
const ITEM_CATEGORY_MAX = 50;

interface TemplateItem {
	id: number;
	label: string;
	category: string;
	createdAt: string;
}

export interface PackingTemplate {
	id: number;
	userId: number;
	name: string;
	isDefault: boolean;
	items: TemplateItem[];
	createdAt: string;
}

function requireTemplateOwner(userId: number, templateId: number) {
	const template = db
		.select()
		.from(packingTemplates)
		.where(and(eq(packingTemplates.id, templateId), eq(packingTemplates.userId, userId)))
		.get();
	if (!template) throw error(404, 'Template not found');
	return template;
}

function loadChecklistItems(tripId: number) {
	const checklist = db.select().from(tripChecklists).where(eq(tripChecklists.tripId, tripId)).get();
	if (!checklist) return [];
	return db
		.select({ text: tripChecklistItems.text })
		.from(tripChecklistItems)
		.where(eq(tripChecklistItems.checklistId, checklist.id))
		.orderBy(tripChecklistItems.createdAt)
		.all();
}

function validateTemplateInput(name: unknown, items: { label: string; category?: string }[]) {
	const validator = new Validator();
	const templateName = validator.requiredString(name, 'name', { max: TEMPLATE_NAME_MAX });
	if (!items.length) {
		validator.addError('items', 'At least one item is required');
	}
	for (let i = 0; i < items.length; i++) {
		const prefix = `items[${i}]`;
		const label = validator.requiredString(items[i]?.label, `${prefix}.label`, { max: ITEM_LABEL_MAX });
		const category = validator.optionalString(items[i]?.category, `${prefix}.category`, {
			max: ITEM_CATEGORY_MAX
		});
		if (label != null) items[i].label = label;
		if (category != null) items[i].category = category;
	}
	if (!validator.ok()) throw error(400, validator.failMessage());
	return { templateName: templateName! };
}

const insertTemplate = sqlite.transaction(
	(
		userId: number,
		name: string,
		items: { label: string; category?: string }[],
		fromTripId?: number
	) => {
		const template = db
			.insert(packingTemplates)
			.values({ userId, name })
			.returning()
			.get();
		if (items.length) {
			db.insert(packingTemplateItems)
				.values(
					items.map((item) => ({
						templateId: template.id,
						label: item.label,
						category: item.category?.trim() || 'general'
					}))
				)
				.run();
		}
		logAudit(userId, 'packing_template_save', 'packing_template', template.id, {
			fromTripId,
			itemCount: items.length
		});
		return template.id;
	}
);

export function saveTemplate(
	userId: number,
	name: string,
	items: { label: string; category?: string }[],
	fromTripId?: number
) {
	if (fromTripId != null) {
		requireEditableTrip(userId, fromTripId);
		const checklistItems = loadChecklistItems(fromTripId);
		items = checklistItems.map((i) => ({ label: i.text, category: 'general' }));
	}
	validateTemplateInput(name, items);
	return insertTemplate(userId, name.trim(), items, fromTripId);
}

export function listTemplates(userId: number): PackingTemplate[] {
	const rows = db
		.select()
		.from(packingTemplates)
		.where(eq(packingTemplates.userId, userId))
		.orderBy(packingTemplates.name)
		.all();
	if (!rows.length) return [];
	const templateIds = rows.map((t) => t.id);
	const items = templateIds.length
		? db
				.select()
				.from(packingTemplateItems)
				.where(inArray(packingTemplateItems.templateId, templateIds))
				.all()
		: [];
	const itemsByTemplate = new Map<number, typeof items>();
	for (const item of items) {
		const list = itemsByTemplate.get(item.templateId) ?? [];
		list.push(item);
		itemsByTemplate.set(item.templateId, list);
	}
	return rows.map((t) => ({
		id: t.id,
		userId: t.userId,
		name: t.name,
		isDefault: t.isDefault,
		createdAt: t.createdAt,
		items: (itemsByTemplate.get(t.id) ?? []).map((i) => ({
			id: i.id,
			label: i.label,
			category: i.category,
			createdAt: i.createdAt
		}))
	}));
}

const applyTx = sqlite.transaction((templateId: number, tripId: number, userId: number) => {
	const template = requireTemplateOwner(userId, templateId);
	const items = db
		.select()
		.from(packingTemplateItems)
		.where(eq(packingTemplateItems.templateId, templateId))
		.orderBy(packingTemplateItems.createdAt)
		.all();
	const checklist = getOrCreateChecklist(tripId);
	if (items.length) {
		db.insert(tripChecklistItems)
			.values(items.map((item) => ({ checklistId: checklist.id, text: item.label })))
			.run();
	}
	logAudit(userId, 'packing_template_apply', 'trip_checklist', checklist.id, {
		templateId,
		tripId,
		itemCount: items.length
	});
	return { template, itemCount: items.length };
});

export function applyTemplate(templateId: number, tripId: number, userId: number) {
	requireEditableTrip(userId, tripId);
	return applyTx(templateId, tripId, userId);
}

export async function saveChecklistTemplate({ locals, params, request }: RequestEvent) {
	const u = requireUser(locals);
	const tripId = parseTripId(params);
	const f = await request.formData();
	const name = String(f.get('name') || '');
	const fromTripId = f.get('fromTripId') != null ? tripId : undefined;
	saveTemplate(u.id, name, [], fromTripId);
	throw redirect(303, `/trips/${tripId}`);
}

export async function applyChecklistTemplate({ locals, params, request }: RequestEvent) {
	const u = requireUser(locals);
	const tripId = parseTripId(params);
	const templateIdRaw = (await request.formData()).get('templateId');
	const validator = new Validator();
	const templateId = validator.positiveId(templateIdRaw, 'templateId');
	if (templateId == null) throw error(400, validator.failMessage());
	applyTemplate(templateId, tripId, u.id);
	throw redirect(303, `/trips/${tripId}`);
}
