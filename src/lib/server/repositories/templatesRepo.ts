import { eq as kitEq, inList as kitInList, asc as kitAsc, and as kitAnd } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import {
	tripTemplates,
	packingTemplates,
	packingTemplateItems
} from '$lib/server/db/mongrelSchema';
import type { Row, Insert, Update } from '@visorcraft/mongreldb-kit';

export type KitTripTemplate = Row<typeof tripTemplates>;
export type KitPackingTemplate = Row<typeof packingTemplates>;
export type KitPackingTemplateItem = Row<typeof packingTemplateItems>;

export interface TripTemplate {
	id: number;
	userId: number;
	name: string;
	sourceTripId: number | null;
	snapshot: Record<string, unknown>;
	createdAt: string;
}

export interface PackingTemplate {
	id: number;
	userId: number;
	name: string;
	isDefault: boolean;
	items: PackingTemplateItem[];
	createdAt: string;
}

export interface PackingTemplateItem {
	id: number;
	templateId: number;
	label: string;
	category: string;
	createdAt: string;
}

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function idFromBigInt(id: bigint): number {
	return Number(id);
}

function parseSnapshot(json: unknown): Record<string, unknown> {
	if (typeof json !== 'string') return (json as Record<string, unknown>) ?? {};
	try {
		return JSON.parse(json) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function toTripTemplate(row: KitTripTemplate): TripTemplate {
	return {
		id: idFromBigInt(row.id),
		userId: idFromBigInt(row.user_id),
		name: row.name,
		sourceTripId: row.source_trip_id != null ? idFromBigInt(row.source_trip_id) : null,
		snapshot: parseSnapshot(row.snapshot_json),
		createdAt: row.created_at
	};
}

function toPackingTemplate(row: KitPackingTemplate): PackingTemplate {
	return {
		id: idFromBigInt(row.id),
		userId: idFromBigInt(row.user_id),
		name: row.name,
		isDefault: row.is_default,
		items: [],
		createdAt: row.created_at
	};
}

function toPackingTemplateItem(row: KitPackingTemplateItem): PackingTemplateItem {
	return {
		id: idFromBigInt(row.id),
		templateId: idFromBigInt(row.template_id),
		label: row.label,
		category: row.category,
		createdAt: row.created_at
	};
}










// Trip templates

export function listTripTemplates(userId: number): TripTemplate[] {
	const nameColumn = tripTemplates.columns.find((c) => c.name === 'name')!;
	const rows = kit
		.selectFrom(tripTemplates)
		.where(kitEq(tripTemplates.user_id, toBigInt(userId)))
		.orderBy(kitAsc(nameColumn))
		.executeSync();
	return rows.map(toTripTemplate);
}

export function getTripTemplateById(id: number): TripTemplate | null {
	const rows = kit.selectFrom(tripTemplates).where(kitEq(tripTemplates.id, toBigInt(id))).executeSync();
	return rows[0] ? toTripTemplate(rows[0]) : null;
}

export interface CreateTripTemplateInput {
	userId: number;
	sourceTripId?: number | null;
	name: string;
	snapshot: Record<string, unknown>;
}

export function createTripTemplate(input: CreateTripTemplateInput): TripTemplate {
	const row = kit
		.insertInto(tripTemplates)
		.values({
			user_id: toBigInt(input.userId),
			name: input.name.trim(),
			source_trip_id: input.sourceTripId != null ? toBigInt(input.sourceTripId) : null,
			snapshot_json: JSON.stringify(input.snapshot)
		} as Insert<typeof tripTemplates>)
		.executeSync();
	return toTripTemplate(row);
}

export function deleteTripTemplate(id: number): number {
	const deleted = kit.deleteFrom(tripTemplates).where(kitEq(tripTemplates.id, toBigInt(id))).executeSync();
	return Number(deleted);
}

export function deleteTripTemplateForUser(id: number, userId: number): number {
	// Owner-scoped delete. The repo's plain deleteTripTemplate is kept
	// for callers that already verified ownership (e.g. tests); MCP must
	// go through this to prevent IDOR.
	const deleted = kit
		.deleteFrom(tripTemplates)
		.where(
			kitAnd(
				kitEq(tripTemplates.id, toBigInt(id)),
				kitEq(tripTemplates.user_id, toBigInt(userId))
			)
		)
		.executeSync();
	return Number(deleted);
}

// Packing templates

function hydratePackingTemplates(rows: KitPackingTemplate[]): PackingTemplate[] {
	if (rows.length === 0) return [];
	const templates = rows.map(toPackingTemplate);
	const templateIds = templates.map((t) => t.id);
	const itemRows = kit
		.selectFrom(packingTemplateItems)
		.where(kitInList(packingTemplateItems.template_id, templateIds.map(toBigInt)))
		.orderBy(kitAsc(packingTemplateItems.created_at))
		.executeSync();
	const itemsByTemplate = new Map<number, PackingTemplateItem[]>();
	for (const row of itemRows) {
		const item = toPackingTemplateItem(row);
		const list = itemsByTemplate.get(item.templateId) ?? [];
		list.push(item);
		itemsByTemplate.set(item.templateId, list);
	}
	for (const template of templates) {
		template.items = itemsByTemplate.get(template.id) ?? [];
	}
	return templates;
}

export function listPackingTemplates(userId: number): PackingTemplate[] {
	const nameColumn = packingTemplates.columns.find((c) => c.name === 'name')!;
	const rows = kit
		.selectFrom(packingTemplates)
		.where(kitEq(packingTemplates.user_id, toBigInt(userId)))
		.orderBy(kitAsc(nameColumn))
		.executeSync();
	return hydratePackingTemplates(rows);
}

export function getPackingTemplateById(id: number): PackingTemplate | null {
	const rows = kit
		.selectFrom(packingTemplates)
		.where(kitEq(packingTemplates.id, toBigInt(id)))
		.executeSync();
	if (!rows[0]) return null;
	return hydratePackingTemplates(rows)[0] ?? null;
}

export interface CreatePackingTemplateInput {
	userId: number;
	name: string;
	isDefault?: boolean;
}

export type UpdatePackingTemplateInput = Partial<Pick<CreatePackingTemplateInput, 'name' | 'isDefault'>>;

export function createPackingTemplate(input: CreatePackingTemplateInput): PackingTemplate {
	const row = kit
		.insertInto(packingTemplates)
		.values({
			user_id: toBigInt(input.userId),
			name: input.name.trim(),
			is_default: input.isDefault ?? false
		} as Insert<typeof packingTemplates>)
		.executeSync();
	return toPackingTemplate(row);
}

export function updatePackingTemplate(
	id: number,
	patch: UpdatePackingTemplateInput
): PackingTemplate | null {
	const set: Update<typeof packingTemplates> = {};
	if (patch.name !== undefined) set.name = patch.name.trim();
	if (patch.isDefault !== undefined) set.is_default = patch.isDefault;

	const updated = kit
		.updateTable(packingTemplates)
		.set(set)
		.where(kitEq(packingTemplates.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	return getPackingTemplateById(id);
}

export function deletePackingTemplate(id: number): number {
	const deleted = kit.deleteFrom(packingTemplates).where(kitEq(packingTemplates.id, toBigInt(id))).executeSync();
	return Number(deleted);
}

export function deletePackingTemplateForUser(id: number, userId: number): number {
	// Owner-scoped delete. MCP must use this to prevent IDOR; tests and
	// already-validated callers can use deletePackingTemplate.
	const deleted = kit
		.deleteFrom(packingTemplates)
		.where(
			kitAnd(
				kitEq(packingTemplates.id, toBigInt(id)),
				kitEq(packingTemplates.user_id, toBigInt(userId))
			)
		)
		.executeSync();
	return Number(deleted);
}

// Packing template items

export function listPackingTemplateItems(templateId: number): PackingTemplateItem[] {
	const rows = kit
		.selectFrom(packingTemplateItems)
		.where(kitEq(packingTemplateItems.template_id, toBigInt(templateId)))
		.orderBy(kitAsc(packingTemplateItems.created_at))
		.executeSync();
	return rows.map(toPackingTemplateItem);
}

export interface CreatePackingTemplateItemInput {
	templateId: number;
	label: string;
	category?: string;
}

export type UpdatePackingTemplateItemInput = Partial<Pick<CreatePackingTemplateItemInput, 'label' | 'category'>>;

export function createPackingTemplateItem(input: CreatePackingTemplateItemInput): PackingTemplateItem {
	const row = kit
		.insertInto(packingTemplateItems)
		.values({
			template_id: toBigInt(input.templateId),
			label: input.label.trim(),
			category: (input.category?.trim() || 'general')
		} as Insert<typeof packingTemplateItems>)
		.executeSync();
	return toPackingTemplateItem(row);
}

export function updatePackingTemplateItem(
	id: number,
	patch: UpdatePackingTemplateItemInput
): PackingTemplateItem | null {
	const set: Update<typeof packingTemplateItems> = {};
	if (patch.label !== undefined) set.label = patch.label.trim();
	if (patch.category !== undefined) set.category = patch.category.trim() || 'general';

	const updated = kit
		.updateTable(packingTemplateItems)
		.set(set)
		.where(kitEq(packingTemplateItems.id, toBigInt(id)))
		.executeSync();
	const row = updated[0];
	if (!row) return null;
	return toPackingTemplateItem(row);
}

export function deletePackingTemplateItem(id: number): number {
	const deleted = kit
		.deleteFrom(packingTemplateItems)
		.where(kitEq(packingTemplateItems.id, toBigInt(id)))
		.executeSync();
	return Number(deleted);
}
