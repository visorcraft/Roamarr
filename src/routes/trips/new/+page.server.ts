import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { createTrip } from '../shared';
import { listTripTemplates, createTripFromTemplate } from '$lib/server/tripTemplates';
import { findCity } from '$lib/server/cities';
import { Validator } from '$lib/server/validation';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = ({ locals }) => {
	const u = requireUser(locals);
	return { tripTemplates: listTripTemplates(u.id) };
};

function parseDestinationCity(v: Validator, f: FormData) {
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

	return {
		destinationCountryCode,
		destinationCityName,
		destinationCityLat,
		destinationCityLng
	};
}

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();

		const name = v.requiredString(f.get('name'), 'name', { max: 200 });
		const destinationCity = parseDestinationCity(v, f);
		const startDate = v.date(f.get('startDate'), 'startDate');
		const endDate = v.date(f.get('endDate'), 'endDate');
		const notes = v.optionalString(f.get('notes'), 'notes', { max: 5000 });
		const tags = v.optionalString(f.get('tags'), 'tags', { max: 200 });
		const defaultVisibility = v.enumValue(
			String(f.get('defaultVisibility') || 'private'),
			['private', 'groups', 'public'] as const,
			'defaultVisibility'
		);
		const templateIdRaw = f.get('templateId');
		const templateId =
			templateIdRaw && String(templateIdRaw).trim()
				? v.positiveId(templateIdRaw, 'templateId')
				: undefined;
		v.dateRange(startDate, endDate);

		if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });

		let t;
		if (templateId) {
			t = createTripFromTemplate(u.id, templateId, {
				name: name!,
				...destinationCity,
				startDate,
				endDate
			});
		} else {
			t = createTrip(u.id, {
				name: name!,
				...destinationCity,
				startDate,
				endDate,
				notes,
				tags,
				defaultVisibility
			});
		}
		throw redirect(303, `/trips/${t.id}`);
	}
};
