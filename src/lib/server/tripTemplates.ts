import { error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { segments, trips, tripTemplates } from './db/schema';
import { requireOwnedTrip } from './ownership';
import { logAudit } from './audit';
import { nowIso } from './tz';
import { serializeTags, parseTags } from '$lib/tags';

export interface TripTemplateSnapshot {
	name: string;
	destination: string | null;
	notes: string | null;
	tags: string[];
	segmentTemplates: Array<{ type: string; title: string; location: string | null }>;
}

export function listTripTemplates(userId: number) {
	return db.select().from(tripTemplates).where(eq(tripTemplates.userId, userId)).orderBy(tripTemplates.name).all();
}

export function saveTripTemplate(userId: number, sourceTripId: number, name: string) {
	requireOwnedTrip(userId, sourceTripId);
	const trip = db.select().from(trips).where(eq(trips.id, sourceTripId)).get();
	if (!trip) throw error(404, 'Trip not found');
	const segs = db
		.select({ type: segments.type, title: segments.title, location: segments.location })
		.from(segments)
		.where(eq(segments.tripId, sourceTripId))
		.orderBy(segments.startAt)
		.all();
	const snapshot: TripTemplateSnapshot = {
		name: trip.name,
		destination: trip.destination,
		notes: trip.notes,
		tags: parseTags(trip.tags),
		segmentTemplates: segs.map((s) => ({ type: s.type, title: s.title, location: s.location }))
	};
	const inserted = db
		.insert(tripTemplates)
		.values({ userId, sourceTripId, name: name.trim(), snapshotJson: JSON.stringify(snapshot) })
		.returning()
		.get();
	logAudit(userId, 'create', 'trip_template', inserted.id, { sourceTripId, name: inserted.name });
	return inserted;
}

export function createTripFromTemplate(
	userId: number,
	templateId: number,
	overrides: { name?: string; destination?: string | null; startDate?: string | null; endDate?: string | null }
) {
	const template = db
		.select()
		.from(tripTemplates)
		.where(and(eq(tripTemplates.id, templateId), eq(tripTemplates.userId, userId)))
		.get();
	if (!template) throw error(404, 'Template not found');
	let snapshot: TripTemplateSnapshot = { name: template.name, destination: null, notes: null, tags: [], segmentTemplates: [] };
	try {
		snapshot = JSON.parse(template.snapshotJson) as TripTemplateSnapshot;
	} catch {
		// ignore
	}
	const name = overrides.name?.trim() || snapshot.name;
	const destination = overrides.destination !== undefined ? overrides.destination : snapshot.destination;
	const startDate = overrides.startDate ?? null;
	const endDate = overrides.endDate ?? null;

	const trip = db
		.insert(trips)
		.values({
			ownerId: userId,
			name,
			destination,
			startDate,
			endDate,
			notes: snapshot.notes,
			tags: serializeTags(snapshot.tags.join(', ')),
			updatedAt: nowIso()
		})
		.returning()
		.get();

	for (const s of snapshot.segmentTemplates) {
		db.insert(segments)
			.values({
				tripId: trip.id,
				type: s.type,
				title: s.title,
				startAt: nowIso(),
				startTz: 'UTC',
				location: s.location,
				updatedAt: nowIso()
			})
			.run();
	}

	logAudit(userId, 'create_from_template', 'trip', trip.id, { templateId });
	return trip;
}
