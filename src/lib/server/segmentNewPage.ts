import { error, type Actions, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { ADD_SEGMENT_WIZARD_TYPES, SEG, type SegmentType } from '$lib/segmentLabels';
import { requireUser } from '$lib/server/auth';
import { requireEditableTrip } from '$lib/server/ownership';
import { db } from '$lib/server/db';
import { trips, cards } from '$lib/server/db/schema';
import { submitAddSegment } from '$lib/server/segmentAdd';

const WIZARD_TYPES = new Set<SegmentType>(ADD_SEGMENT_WIZARD_TYPES.map((entry) => entry.type));

function isWizardSegmentType(type: string): type is SegmentType {
	return WIZARD_TYPES.has(type as SegmentType);
}

export function loadNewSegmentPicker(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');
	requireEditableTrip(u.id, tripId);
	const trip = db
		.select({ id: trips.id, name: trips.name })
		.from(trips)
		.where(eq(trips.id, tripId))
		.get();
	if (!trip) throw error(404, 'Not found');
	return { trip };
}

function loadNewSegmentForm(event: RequestEvent, type: SegmentType) {
	const { trip } = loadNewSegmentPicker(event);
	if (!isWizardSegmentType(type)) throw error(404, 'Not found');
	const u = requireUser(event.locals);
	const userCards = db
		.select({ id: cards.id, nickname: cards.nickname, network: cards.network, last4: cards.last4 })
		.from(cards)
		.where(eq(cards.userId, u.id))
		.all();
	return { trip, type, label: SEG[type].label, cards: userCards };
}

export function newSegmentPage(type: SegmentType) {
	return {
		load: (event: RequestEvent) => loadNewSegmentForm(event, type),
		actions: {
			default: (event: RequestEvent) => submitAddSegment(event, type)
		} satisfies Actions
	};
}
