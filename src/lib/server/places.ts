import { eq, and, desc } from '@visorcraft/mongreldb-kit';
import { error } from '@sveltejs/kit';
import { kit } from '$lib/server/db';
import { placeCategories, places, geonamesCities } from '$lib/server/db/mongrelSchema';
import { assertOwnedRefs } from '$lib/server/ownership';
import { nowIso } from '$lib/server/tz';
import {
	createAttachment,
	deleteAttachment
} from '$lib/server/attachments/attachmentService';
import { logAudit } from '$lib/server/audit';
import type { Row, Insert, Update, ColumnSpec } from '@visorcraft/mongreldb-kit';
import type { PlaceStatus } from '$lib/server/db/mongrelSchema';

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function idFromBigInt(id: bigint): number {
	return Number(id);
}

function optionalBigInt(value: number | null | undefined): bigint | null {
	return value == null ? null : BigInt(value);
}

function optionalNumber(value: bigint | null | undefined): number | null {
	return value == null ? null : Number(value);
}

function optionalFkNumber(value: bigint | null | undefined): number | null {
	return value == null || value === 0n ? null : Number(value);
}

function nullableText(value: string | null | undefined): string | null {
	return value == null || value === '' ? null : value;
}

/** Fire-and-forget semantic index refresh; no-op when embeddings are disabled. */
function schedulePlaceIndex(placeId: number): void {
	void import('./embeddings/search')
		.then((m) => m.scheduleIndexPlace(placeId))
		.catch(() => {});
}

function schedulePlaceRemove(placeId: number): void {
	void import('./embeddings/search')
		.then((m) => m.scheduleRemovePlace(placeId))
		.catch(() => {});
}

/** Category renames/deletes change indexed text for every linked place. */
function scheduleCategoryPlacesReindex(categoryId: number, userId: number): void {
	const ids = kit
		.selectFrom(places)
		.where(and(eq(places.category_id, toBigInt(categoryId)), eq(places.user_id, toBigInt(userId))))
		.executeSync()
		.map((r) => idFromBigInt(r.id));
	for (const id of ids) schedulePlaceIndex(id);
}

// updateTable cannot clear nullable FK columns to NULL (see profileRepo);
// delete + reinsert with the merged row instead.
function kitReinsertWithId(
	table: { id: ColumnSpec; columns: readonly ColumnSpec[] },
	existing: Record<string, unknown>,
	patch: Record<string, unknown>
): Record<string, unknown> {
	const updated = { ...existing, ...patch };
	kit.deleteFrom(table as never).where(eq(table.id, existing.id as bigint)).executeSync();
	return kit.insertInto(table as never).values(updated as Insert<never>).executeSync();
}

// ============================================================================
// Place categories
// ============================================================================

export interface PlaceCategory {
	id: number;
	userId: number;
	name: string;
	color: string;
	createdAt: string;
}

export interface PlaceCategoryInput {
	name: string;
	color?: string | null;
}

export const DEFAULT_PLACE_CATEGORIES: ReadonlyArray<{ name: string; color: string }> = [
	{ name: 'Nature & Outdoor', color: '#2f9e44' },
	{ name: 'Entertainment & Leisure', color: '#7048e8' },
	{ name: 'Culture', color: '#c2255c' },
	{ name: 'Food & Drink', color: '#e8590c' },
	{ name: 'Adventure & Sports', color: '#1971c2' },
	{ name: 'Festival & Event', color: '#f08c00' },
	{ name: 'Wellness', color: '#0ca678' },
	{ name: 'Accommodation', color: '#495057' }
];

const CATEGORY_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function toPlaceCategory(row: Row<typeof placeCategories>): PlaceCategory {
	return {
		id: idFromBigInt(row.id),
		userId: idFromBigInt(row.user_id),
		name: row.name,
		color: row.color,
		createdAt: row.created_at
	};
}

function validatePlaceCategoryInput(input: PlaceCategoryInput) {
	if (!input.name.trim()) throw error(400, 'Category name is required');
	if (input.name.trim().length > 100) throw error(400, 'Category name must be 100 characters or less');
	const color = input.color?.trim();
	if (color && !CATEGORY_COLOR_PATTERN.test(color)) {
		throw error(400, 'Category color must be a hex color like #2f9e44');
	}
}

/** Lazy per-user seed, like benefit templates: first access creates the defaults. */
export function ensureDefaultCategories(userId: number): void {
	const count = Number(
		kit
			.selectFrom(placeCategories)
			.where(eq(placeCategories.user_id, toBigInt(userId)))
			.selectCount()
			.executeSync()
	);
	if (count > 0) return;
	for (const def of DEFAULT_PLACE_CATEGORIES) {
		kit
			.insertInto(placeCategories)
			.values({
				user_id: toBigInt(userId),
				name: def.name,
				color: def.color
			} as Insert<typeof placeCategories>)
			.executeSync();
	}
}

export function listPlaceCategories(userId: number): PlaceCategory[] {
	ensureDefaultCategories(userId);
	// Note: `placeCategories.name` is the table-name string on the table
	// object, not the column — sort in memory instead of orderBy.
	const rows = kit
		.selectFrom(placeCategories)
		.where(eq(placeCategories.user_id, toBigInt(userId)))
		.executeSync();
	return rows.map(toPlaceCategory).sort((a, b) => a.name.localeCompare(b.name));
}

export function getPlaceCategoryById(id: number, userId: number): PlaceCategory | null {
	const rows = kit
		.selectFrom(placeCategories)
		.where(and(eq(placeCategories.id, toBigInt(id)), eq(placeCategories.user_id, toBigInt(userId))))
		.executeSync();
	return rows[0] ? toPlaceCategory(rows[0]) : null;
}

export function createPlaceCategory(userId: number, input: PlaceCategoryInput): PlaceCategory {
	validatePlaceCategoryInput(input);
	const row = kit
		.insertInto(placeCategories)
		.values({
			user_id: toBigInt(userId),
			name: input.name.trim(),
			color: input.color?.trim() || '#64748b'
		} as Insert<typeof placeCategories>)
		.executeSync();
	return toPlaceCategory(row);
}

export function updatePlaceCategory(
	id: number,
	userId: number,
	input: PlaceCategoryInput
): PlaceCategory | null {
	validatePlaceCategoryInput(input);
	const existing = getPlaceCategoryById(id, userId);
	if (!existing) throw error(404, 'Not found');
	const rows = kit
		.updateTable(placeCategories)
		.set({ name: input.name.trim(), color: input.color?.trim() || existing.color })
		.where(and(eq(placeCategories.id, toBigInt(id)), eq(placeCategories.user_id, toBigInt(userId))))
		.executeSync();
	if (rows[0] && rows[0].name !== existing.name) {
		scheduleCategoryPlacesReindex(id, userId);
	}
	return rows[0] ? toPlaceCategory(rows[0]) : null;
}

export function deletePlaceCategory(id: number, userId: number): bigint {
	const existing = getPlaceCategoryById(id, userId);
	if (!existing) throw error(404, 'Not found');
	// FK onDelete set null unlinks places on delete, so capture them first.
	const affected = kit
		.selectFrom(places)
		.where(and(eq(places.category_id, toBigInt(id)), eq(places.user_id, toBigInt(userId))))
		.executeSync()
		.map((r) => idFromBigInt(r.id));
	// FK onDelete set null unlinks places; they are never removed with a category.
	const deleted = kit.deleteFrom(placeCategories).where(eq(placeCategories.id, toBigInt(id))).executeSync();
	// Linked places lost their category name from indexed text; refresh them.
	for (const placeId of affected) schedulePlaceIndex(placeId);
	return deleted;
}

// ============================================================================
// Places
// ============================================================================

export interface Place {
	id: number;
	userId: number;
	categoryId: number | null;
	name: string;
	address: string | null;
	cityId: number | null;
	lat: number | null;
	lng: number | null;
	durationMin: number | null;
	/** Minor currency units (cents). */
	priceCents: number | null;
	description: string | null;
	status: PlaceStatus;
	visitedAt: string | null;
	favorite: boolean;
	imageAttachmentId: number | null;
	gpxAttachmentId: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface PlaceInput {
	categoryId?: number | null;
	name: string;
	address?: string | null;
	cityId?: number | null;
	lat?: number | null;
	lng?: number | null;
	durationMin?: number | null;
	priceCents?: number | null;
	description?: string | null;
	status?: PlaceStatus;
	favorite?: boolean;
}

/** Partial update: absent keys are left untouched (never written as NULL). */
export type PlacePatch = Partial<PlaceInput>;

function toPlace(row: Row<typeof places>): Place {
	return {
		id: idFromBigInt(row.id),
		userId: idFromBigInt(row.user_id),
		categoryId: optionalFkNumber(row.category_id),
		name: row.name,
		address: nullableText(row.address),
		cityId: optionalFkNumber(row.city_id),
		lat: row.lat ?? null,
		lng: row.lng ?? null,
		durationMin: optionalNumber(row.duration_min),
		priceCents: optionalNumber(row.price),
		description: nullableText(row.description),
		status: row.status as PlaceStatus,
		visitedAt: nullableText(row.visited_at),
		favorite: row.favorite,
		imageAttachmentId: optionalFkNumber(row.image_attachment_id),
		gpxAttachmentId: optionalFkNumber(row.gpx_attachment_id),
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function validateCoords(lat: number | null | undefined, lng: number | null | undefined) {
	if (lat != null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
		throw error(400, 'Latitude must be between -90 and 90');
	}
	if (lng != null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) {
		throw error(400, 'Longitude must be between -180 and 180');
	}
	if ((lat == null) !== (lng == null)) {
		throw error(400, 'Latitude and longitude must be set together');
	}
}

function validatePlaceFields(input: PlacePatch, { partial }: { partial: boolean }) {
	if (!partial || input.name !== undefined) {
		if (!input.name?.trim()) throw error(400, 'Name is required');
		if (input.name.trim().length > 200) throw error(400, 'Name must be 200 characters or less');
	}
	if (input.address != null && input.address.length > 300) {
		throw error(400, 'Address must be 300 characters or less');
	}
	if (input.description != null && input.description.length > 2000) {
		throw error(400, 'Description must be 2000 characters or less');
	}
	if (input.durationMin != null && (!Number.isInteger(input.durationMin) || input.durationMin < 0)) {
		throw error(400, 'Duration must be a non-negative whole number of minutes');
	}
	if (input.priceCents != null && (!Number.isInteger(input.priceCents) || input.priceCents < 0)) {
		throw error(400, 'Price must be a non-negative whole number (minor units)');
	}
	if (input.status !== undefined && input.status !== 'planned' && input.status !== 'visited') {
		throw error(400, 'Status must be planned or visited');
	}
	validateCoords(input.lat, input.lng);
}

/** City rows are global GeoNames reference data; ownership is n/a, existence is checked. */
function assertCityExists(cityId: number) {
	const row = kit
		.selectFrom(geonamesCities)
		.where(eq(geonamesCities.geoname_id, toBigInt(cityId)))
		.executeSync()[0];
	if (!row) throw error(400, 'Selected city was not found in the GeoNames database');
}

function toKitPlacePatch(input: PlacePatch): Update<typeof places> {
	const patch: Record<string, unknown> = {};
	if (input.categoryId !== undefined) patch.category_id = optionalBigInt(input.categoryId);
	if (input.name !== undefined) patch.name = input.name.trim();
	if (input.address !== undefined) patch.address = input.address?.trim() || null;
	if (input.cityId !== undefined) patch.city_id = optionalBigInt(input.cityId);
	if (input.lat !== undefined) patch.lat = input.lat;
	if (input.lng !== undefined) patch.lng = input.lng;
	if (input.durationMin !== undefined) patch.duration_min = optionalBigInt(input.durationMin);
	if (input.priceCents !== undefined) patch.price = optionalBigInt(input.priceCents);
	if (input.description !== undefined) patch.description = input.description?.trim() || null;
	if (input.status !== undefined) patch.status = input.status;
	if (input.favorite !== undefined) patch.favorite = input.favorite;
	return patch as Update<typeof places>;
}

export interface ListPlacesOptions {
	categoryId?: number | null;
	status?: PlaceStatus;
	favorite?: boolean;
	search?: string;
}

export function listPlaces(userId: number, opts: ListPlacesOptions = {}): Place[] {
	let rows = kit
		.selectFrom(places)
		.where(eq(places.user_id, toBigInt(userId)))
		.orderBy(desc(places.id))
		.executeSync();
	if (opts.categoryId != null) {
		rows = rows.filter((r) => optionalFkNumber(r.category_id) === opts.categoryId);
	}
	let result = rows.map(toPlace);
	if (opts.status) result = result.filter((p) => p.status === opts.status);
	if (opts.favorite) result = result.filter((p) => p.favorite);
	const q = opts.search?.trim().toLowerCase();
	if (q) {
		result = result.filter(
			(p) =>
				p.name.toLowerCase().includes(q) ||
				(p.address?.toLowerCase().includes(q) ?? false) ||
				(p.description?.toLowerCase().includes(q) ?? false)
		);
	}
	return result;
}

export function getPlaceById(id: number, userId: number): Place | null {
	const rows = kit
		.selectFrom(places)
		.where(and(eq(places.id, toBigInt(id)), eq(places.user_id, toBigInt(userId))))
		.executeSync();
	return rows[0] ? toPlace(rows[0]) : null;
}

export function createPlace(userId: number, input: PlaceInput): Place {
	validatePlaceFields(input, { partial: false });
	assertOwnedRefs(userId, { placeCategoryId: input.categoryId });
	if (input.cityId != null) assertCityExists(input.cityId);
	const row = kit
		.insertInto(places)
		.values({
			user_id: toBigInt(userId),
			visited_at: input.status === 'visited' ? nowIso() : null,
			...toKitPlacePatch({ favorite: false, status: 'planned', ...input })
		} as Insert<typeof places>)
		.executeSync();
	const place = toPlace(row);
	schedulePlaceIndex(place.id);
	return place;
}

export function updatePlace(id: number, userId: number, input: PlacePatch): Place | null {
	validatePlaceFields(input, { partial: true });
	const existing = getPlaceById(id, userId);
	if (!existing) throw error(404, 'Not found');
	if (input.categoryId !== undefined && input.categoryId !== null) {
		assertOwnedRefs(userId, { placeCategoryId: input.categoryId });
	}
	if (input.cityId !== undefined && input.cityId !== null) assertCityExists(input.cityId);

	const patch = toKitPlacePatch(input) as Record<string, unknown>;
	// Status changes via update keep visited_at coherent.
	if (input.status === 'visited' && existing.status !== 'visited') {
		patch.visited_at = existing.visitedAt ?? nowIso();
	}
	if (input.status === 'planned' && existing.status === 'visited') {
		patch.visited_at = null;
	}
	if (Object.keys(patch).length === 0) return existing;

	let row: Row<typeof places>;
	if (Object.values(patch).some((value) => value === null)) {
		const existingRow = kit
			.selectFrom(places)
			.where(and(eq(places.id, toBigInt(id)), eq(places.user_id, toBigInt(userId))))
			.executeSync()[0]!;
		row = kitReinsertWithId(places, existingRow, patch) as Row<typeof places>;
	} else {
		const rows = kit
			.updateTable(places)
			.set(patch as Update<typeof places>)
			.where(and(eq(places.id, toBigInt(id)), eq(places.user_id, toBigInt(userId))))
			.executeSync();
		row = rows[0]!;
	}
	const updated = toPlace(row);
	schedulePlaceIndex(updated.id);
	return updated;
}

export async function deletePlace(id: number, userId: number): Promise<bigint> {
	const existing = getPlaceById(id, userId);
	if (!existing) throw error(404, 'Not found');
	// Remove gallery rows + their attachments before the place row goes away
	// (gallery_images.owner_id is polymorphic and cannot cascade via FK).
	const { deleteGalleryForOwner } = await import('./gallery');
	const galleryAttachmentIds = new Set(await deleteGalleryForOwner('place', id));
	const result = kit.deleteFrom(places).where(eq(places.id, toBigInt(id))).executeSync();
	schedulePlaceRemove(id);
	// Clean up linked attachments so ciphertext does not orphan on disk.
	for (const attachmentId of [existing.imageAttachmentId, existing.gpxAttachmentId]) {
		if (attachmentId != null && !galleryAttachmentIds.has(attachmentId)) {
			try {
				await deleteAttachment(attachmentId);
			} catch (e) {
				console.warn('Failed to delete place attachment', { placeId: id, attachmentId, error: e });
			}
		}
	}
	return result;
}

// ============================================================================
// Place GPX tracks
// ============================================================================

/** Set or clear image_attachment_id (gallery cover); NULL requires the delete+reinsert path. */
export function setPlaceImageAttachment(
	id: number,
	userId: number,
	attachmentId: number | null
): Place {
	const existingRow = kit
		.selectFrom(places)
		.where(and(eq(places.id, toBigInt(id)), eq(places.user_id, toBigInt(userId))))
		.executeSync()[0];
	if (!existingRow) throw error(404, 'Not found');
	if (attachmentId == null) {
		const row = kitReinsertWithId(places, existingRow, { image_attachment_id: null });
		return toPlace(row as Row<typeof places>);
	}
	const rows = kit
		.updateTable(places)
		.set({ image_attachment_id: toBigInt(attachmentId) } as Update<typeof places>)
		.where(and(eq(places.id, toBigInt(id)), eq(places.user_id, toBigInt(userId))))
		.executeSync();
	return toPlace(rows[0]!);
}

/** Set or clear gpx_attachment_id; NULL requires the delete+reinsert path. */
function setPlaceGpxAttachment(id: number, userId: number, attachmentId: number | null): Place {
	const existingRow = kit
		.selectFrom(places)
		.where(and(eq(places.id, toBigInt(id)), eq(places.user_id, toBigInt(userId))))
		.executeSync()[0];
	if (!existingRow) throw error(404, 'Not found');
	if (attachmentId == null) {
		const row = kitReinsertWithId(places, existingRow, { gpx_attachment_id: null });
		return toPlace(row as Row<typeof places>);
	}
	const rows = kit
		.updateTable(places)
		.set({ gpx_attachment_id: toBigInt(attachmentId) } as Update<typeof places>)
		.where(and(eq(places.id, toBigInt(id)), eq(places.user_id, toBigInt(userId))))
		.executeSync();
	return toPlace(rows[0]!);
}

/** Attach a GPX track to a place the user owns; replaces any existing track. */
export async function attachPlaceGpx(userId: number, placeId: number, file: File): Promise<Place> {
	const existing = getPlaceById(placeId, userId);
	if (!existing) throw error(404, 'Not found');

	const attachment = await createAttachment({
		ownerId: userId,
		file,
		context: { kind: 'place_gpx', placeId }
	});

	let updated: Place;
	try {
		updated = setPlaceGpxAttachment(placeId, userId, attachment.id);
	} catch (e) {
		await deleteAttachment(attachment.id);
		throw e;
	}

	// One GPX per place: drop the replaced attachment after the swap.
	if (existing.gpxAttachmentId != null) {
		try {
			await deleteAttachment(existing.gpxAttachmentId);
		} catch (e) {
			console.warn('Failed to delete replaced place GPX attachment', {
				placeId,
				attachmentId: existing.gpxAttachmentId,
				error: e
			});
		}
	}

	logAudit(userId, 'place_gpx_attach', 'place', placeId, {
		attachmentId: attachment.id,
		filename: file.name
	});
	return updated;
}

/** Detach and delete a place's GPX track. */
export async function removePlaceGpx(userId: number, placeId: number): Promise<void> {
	const existing = getPlaceById(placeId, userId);
	if (!existing) throw error(404, 'Not found');
	if (existing.gpxAttachmentId == null) return;
	setPlaceGpxAttachment(placeId, userId, null);
	await deleteAttachment(existing.gpxAttachmentId);
	logAudit(userId, 'place_gpx_remove', 'place', placeId, {
		attachmentId: existing.gpxAttachmentId
	});
}

export function setPlaceVisited(id: number, userId: number, visited: boolean): Place {
	const existing = getPlaceById(id, userId);
	if (!existing) throw error(404, 'Not found');
	const patch: Record<string, unknown> = visited
		? { status: 'visited', visited_at: existing.visitedAt ?? nowIso() }
		: { status: 'planned', visited_at: null };
	let row: Row<typeof places>;
	if (!visited) {
		const existingRow = kit
			.selectFrom(places)
			.where(and(eq(places.id, toBigInt(id)), eq(places.user_id, toBigInt(userId))))
			.executeSync()[0]!;
		row = kitReinsertWithId(places, existingRow, patch) as Row<typeof places>;
	} else {
		row = kit
			.updateTable(places)
			.set(patch as Update<typeof places>)
			.where(and(eq(places.id, toBigInt(id)), eq(places.user_id, toBigInt(userId))))
			.executeSync()[0]!;
	}
	const updated = toPlace(row);
	schedulePlaceIndex(updated.id);
	return updated;
}

/** Deliberate MCP/API projection: no raw row spread, no internal FK noise. */
export function projectPlace(place: Place) {
	return {
		id: place.id,
		categoryId: place.categoryId,
		name: place.name,
		address: place.address,
		cityId: place.cityId,
		lat: place.lat,
		lng: place.lng,
		durationMin: place.durationMin,
		priceCents: place.priceCents,
		description: place.description,
		status: place.status,
		visitedAt: place.visitedAt,
		favorite: place.favorite,
		// Presence flags derived from the attachment FKs (no extra queries) so
		// clients can skip blind-probing the image/GPX download endpoints.
		hasImage: place.imageAttachmentId != null,
		hasGpx: place.gpxAttachmentId != null,
		createdAt: place.createdAt,
		updatedAt: place.updatedAt
	};
}

export function projectPlaceCategory(category: PlaceCategory) {
	return {
		id: category.id,
		name: category.name,
		color: category.color,
		createdAt: category.createdAt
	};
}
