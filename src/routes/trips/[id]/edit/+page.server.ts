import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip, requireEditableTrip } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';
import { cancelRemindersFor } from '$lib/server/reminders';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { listSegmentsForTrip } from '$lib/server/repositories/segmentsRepo';
import { nowIso } from '$lib/server/tz';
import { parseTripId } from '$lib/server/params';
import { Validator } from '$lib/server/validation';
import { TRIP_STATUSES } from '$lib/server/sharing';
import { serializeTags } from '$lib/tags';
import { findCity } from '$lib/server/cities';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const u = requireUser(locals);
	const tripId = parseTripId(params);
	const trip = requireEditableTrip(u.id, tripId);
	return { trip, owner: trip.ownerId === u.id };
};

export function _deleteTrip(userId: number, tripId: number) {
	requireOwnedTrip(userId, tripId);
	cancelRemindersFor('trip', tripId);
	const segs = listSegmentsForTrip(tripId);
	for (const s of segs) cancelRemindersFor('segment', s.id);
	tripsRepo.deleteTrip(tripId);
	logAudit(userId, 'trip_delete', 'trip', tripId);
}

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const tripId = parseTripId(params);
		requireEditableTrip(u.id, tripId);
		const f = await request.formData();
		const v = new Validator();

		const name = v.requiredString(f.get('name'), 'name', { max: 200 });

		const destinationCountryCodeRaw = v.optionalString(
			f.get('destinationCountryCode'),
			'destinationCountryCode',
			{ max: 2 }
		);
		const destinationCountryCode =
			destinationCountryCodeRaw && /^[A-Za-z]{2}$/.test(destinationCountryCodeRaw)
				? destinationCountryCodeRaw.toUpperCase()
				: undefined;
		if (destinationCountryCodeRaw && !destinationCountryCode) {
			v.addError('destinationCountryCode', 'Destination country must be a 2-letter code');
		}
		const destinationCityName = v.optionalString(
			f.get('destinationCityName'),
			'destinationCityName',
			{ max: 200 }
		);
		const destinationCityLat = f.get('destinationCityLat')
			? v.latitude(f.get('destinationCityLat'), 'destinationCityLat')
			: undefined;
		const destinationCityLng = f.get('destinationCityLng')
			? v.longitude(f.get('destinationCityLng'), 'destinationCityLng')
			: undefined;

		if (destinationCountryCode && destinationCityName) {
			const city = findCity(destinationCountryCode, destinationCityName);
			if (!city) {
				v.addError('destinationCityName', 'Selected city was not found in the GeoNames database');
			} else if (destinationCityLat == null || destinationCityLng == null) {
				v.addError('destinationCityName', 'City coordinates are missing');
			}
		}

		const startDate = v.date(f.get('startDate'), 'startDate');
		const endDate = v.date(f.get('endDate'), 'endDate');
		const notes = v.optionalString(f.get('notes'), 'notes', { max: 5000 });
		const tags = v.optionalString(f.get('tags'), 'tags', { max: 200 });
		const statusRaw = f.get('status');
		const status =
			typeof statusRaw === 'string' && statusRaw
				? v.enumValue(statusRaw, TRIP_STATUSES, 'status')
				: undefined;
		const baseCurrencyRaw = String(f.get('baseCurrency') || 'USD').trim().toUpperCase();
		if (!baseCurrencyRaw || baseCurrencyRaw.length > 3) {
			v.addError('baseCurrency', 'Base currency must be 1-3 letters');
		}
		v.dateRange(startDate, endDate);

		if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });

		tripsRepo.updateTrip(tripId, {
			name: name!,
			destination: null,
			destinationCountryCode,
			destinationCityName,
			destinationCityLat,
			destinationCityLng,
			startDate,
			endDate,
			notes,
			tags: serializeTags(tags),
			baseCurrency: baseCurrencyRaw,
			...(status && { status }),
			updatedAt: nowIso()
		});
		logAudit(u.id, 'trip_update', 'trip', tripId, { status });
		throw redirect(303, `/trips/${params.id}`);
	},
	delete: async ({ locals, params }) => {
		const u = requireUser(locals);
		_deleteTrip(u.id, parseTripId(params));
		throw redirect(303, '/trips');
	}
};
