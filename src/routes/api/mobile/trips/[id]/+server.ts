import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { loadTripFor } from '../../../../trips/shared';

const id = (raw: string | undefined) => { const value = Number(raw); if (!Number.isSafeInteger(value) || value < 1) throw error(404, 'Not found'); return value; };

export const GET: RequestHandler = ({ locals, params }) => {
	const user = requireUser(locals), view = loadTripFor(user.id, id(params.id));
	if (!view.editor) return json({ trip: { ...view.trip, canEdit: false, owner: false } });
	const trip = view.trip;
	return json({ trip: {
		id: trip.id, name: trip.name, destination: trip.destination, destinationCountryCode: trip.destinationCountryCode,
		destinationCityName: trip.destinationCityName, destinationCityLat: trip.destinationCityLat, destinationCityLng: trip.destinationCityLng,
		startDate: trip.startDate, endDate: trip.endDate, status: trip.status, notes: trip.notes,
		tags: (() => { try { return JSON.parse(trip.tags); } catch { return []; } })(), baseCurrency: trip.baseCurrency,
		defaultVisibility: trip.defaultVisibility, archived: trip.archived, favorite: trip.favorite,
		posterAttachmentId: trip.posterAttachmentId, segments: view.segments.map(({ confirmationNumber: _confirmationNumber, detailsJson: _detailsJson, ...segment }) => segment),
		canEdit: true, owner: view.owner
	} });
};
