import { fail, redirect, type Actions } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { logAudit } from '$lib/server/audit';
import { Validator, httpUrl } from '$lib/server/validation';
import { findCity, resolveCitySelection } from '$lib/server/cities';
import { getMapSettings } from '$lib/server/settings';
import { resolveTileConfig } from '$lib/server/mapTiles';
import {
	listPlaces,
	listPlaceCategories,
	getPlaceById,
	createPlace,
	updatePlace,
	deletePlace,
	setPlaceVisited,
	attachPlaceGpx,
	removePlaceGpx,
	createPlaceCategory,
	deletePlaceCategory,
	type PlaceInput,
	type PlacePatch
} from '$lib/server/places';
import {
	listGalleriesForOwners,
	getGalleryImage,
	addGalleryImages,
	removeGalleryImage,
	moveGalleryImage,
	setGalleryCaption,
	collectGalleryFiles,
	MAX_CAPTION_LENGTH
} from '$lib/server/gallery';
import {
	listPlaceLinksForPlaces,
	createPlaceLink,
	updatePlaceLink,
	deletePlaceLink,
	getPlaceLinkById,
	PLACE_LINK_LABEL_MAX,
	PLACE_LINK_NOTES_MAX,
	type PlaceLink
} from '$lib/server/placeLinks';
import { PLACE_STATUSES } from '$lib/server/db/mongrelSchema';
import type { PageServerLoad } from './$types';

const DEFAULT_CATEGORY_COLOR = '#64748b';

function parsePriceCents(v: Validator, raw: FormDataEntryValue | null): number | null | undefined {
	const s = typeof raw === 'string' ? raw.trim() : '';
	if (!s) return null;
	const n = Number(s);
	if (!Number.isFinite(n) || n < 0) {
		v.addError('price', 'price must be a non-negative number');
		return undefined;
	}
	return Math.round(n * 100);
}

function parseDurationMin(v: Validator, raw: FormDataEntryValue | null): number | null | undefined {
	const s = typeof raw === 'string' ? raw.trim() : '';
	if (!s) return null;
	const n = Number(s);
	if (!Number.isInteger(n) || n < 0) {
		v.addError('durationMin', 'duration must be a non-negative whole number of minutes');
		return undefined;
	}
	return n;
}

function parsePlaceForm(f: FormData): { v: Validator; input: PlaceInput } {
	const v = new Validator();
	const name = v.requiredString(f.get('name'), 'name', { max: 200 });
	const categoryId = f.get('categoryId') ? v.positiveId(f.get('categoryId'), 'categoryId') : null;
	const address = v.optionalString(f.get('address'), 'address', { max: 300 });
	const description = v.optionalString(f.get('description'), 'description', { max: 2000 });
	const status = f.get('status')
		? v.enumValue(String(f.get('status')).trim(), PLACE_STATUSES, 'status')
		: undefined;
	const favorite = f.get('favorite') === 'on';
	const durationMin = parseDurationMin(v, f.get('durationMin'));
	const priceCents = parsePriceCents(v, f.get('price'));

	const countryCode =
		f.get('countryCode') && String(f.get('countryCode')).trim()
			? v.countryCode(f.get('countryCode'), 'countryCode')
			: undefined;
	const cityNameRaw = v.optionalString(f.get('cityName'), 'cityName', { max: 200 });
	const cityLatRaw = f.get('cityLat') ? v.latitude(f.get('cityLat'), 'cityLat') : undefined;
	const cityLngRaw = f.get('cityLng') ? v.longitude(f.get('cityLng'), 'cityLng') : undefined;
	const latRaw = f.get('lat') ? v.latitude(f.get('lat'), 'lat') : undefined;
	const lngRaw = f.get('lng') ? v.longitude(f.get('lng'), 'lng') : undefined;

	let cityId: number | null = null;
	let lat = latRaw ?? null;
	let lng = lngRaw ?? null;
	if (countryCode && cityNameRaw) {
		const resolved = resolveCitySelection(countryCode, cityNameRaw, cityLatRaw, cityLngRaw);
		if (!resolved.ok) {
			v.addError('cityName', resolved.error);
		} else {
			// Explicit lat/lng inputs win; otherwise fall back to the city's coords.
			if (lat == null || lng == null) {
				lat = resolved.city.lat;
				lng = resolved.city.lng;
			}
			cityId = findCity(countryCode, resolved.city.name, resolved.city.admin1Code)?.geonameId ?? null;
		}
	}

	return {
		v,
		input: {
			name: name ?? '',
			categoryId: categoryId ?? null,
			address: address ?? null,
			cityId,
			lat,
			lng,
			durationMin: durationMin ?? null,
			priceCents: priceCents ?? null,
			description: description ?? null,
			status: status ?? 'planned',
			favorite
		}
	};
}

export const load: PageServerLoad = ({ locals, url }) => {
	const u = requireUser(locals);
	const categories = listPlaceCategories(u.id);

	const categoryParam = url.searchParams.get('category');
	const categoryId = categoryParam && Number.isFinite(Number(categoryParam)) ? Number(categoryParam) : null;
	const statusParam = url.searchParams.get('status');
	const status = statusParam === 'planned' || statusParam === 'visited' ? statusParam : null;
	const favorite = url.searchParams.get('favorite') === '1';
	const q = url.searchParams.get('q')?.trim() ?? '';

	const places = listPlaces(u.id, {
		categoryId,
		status: status ?? undefined,
		favorite: favorite || undefined,
		search: q || undefined
	});
	const colorByCategory = new Map(categories.map((c) => [c.id, c.color]));
	const placeColor = (p: (typeof places)[number]) =>
		(p.categoryId != null && colorByCategory.get(p.categoryId)) || DEFAULT_CATEGORY_COLOR;
	const markers = places
		.filter((p) => p.lat != null && p.lng != null)
		.map((p) => ({
			id: p.id,
			name: p.name,
			lat: p.lat!,
			lng: p.lng!,
			color: placeColor(p)
		}));
	const gpxTracks = places
		.filter((p) => p.gpxAttachmentId != null)
		.map((p) => ({
			url: `/places/${p.id}/gpx`,
			label: p.name,
			color: placeColor(p)
		}));

	const mapsEnabled = getMapSettings().mapsEnabled;
	const galleryByPlace = listGalleriesForOwners(
		'place',
		places.map((p) => p.id)
	);
	const galleries: Record<number, { id: number; url: string; caption: string | null; filename: string }[]> = {};
	for (const [placeId, images] of galleryByPlace) {
		galleries[placeId] = images.map((image) => ({
			id: image.id,
			url: `/places/${placeId}/gallery/${image.id}`,
			caption: image.caption,
			filename: image.filename
		}));
	}
	const linksByPlace: Record<number, PlaceLink[]> = {};
	for (const [placeId, links] of listPlaceLinksForPlaces(places.map((p) => p.id))) {
		linksByPlace[placeId] = links;
	}
	return {
		places,
		categories,
		filters: { categoryId, status, favorite, q },
		mapsEnabled,
		map: mapsEnabled ? resolveTileConfig() : null,
		markers,
		gpxTracks: mapsEnabled ? gpxTracks : [],
		galleries,
		linksByPlace
	};
};

export const actions: Actions = {
	savePlace: async ({ request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const limit = checkRateLimit(getClientAddress(), 'places:save');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const f = await request.formData();
		const { v, input } = parsePlaceForm(f);
		if (!v.ok()) {
			return fail(400, { error: v.failMessage(), errors: v.errors });
		}
		const idRaw = f.get('id');
		if (idRaw && String(idRaw).trim()) {
			const id = v.positiveId(idRaw, 'id');
			if (!v.ok() || !id) return fail(400, { error: v.failMessage(), errors: v.errors });
			const existing = getPlaceById(id, u.id);
			if (!existing) return fail(404, { error: 'Not found' });
			updatePlace(id, u.id, input as PlacePatch);
			logAudit(u.id, 'place_update', 'place', id);
		} else {
			const place = createPlace(u.id, input);
			logAudit(u.id, 'place_create', 'place', place.id);
		}
		throw redirect(303, '/places');
	},

	deletePlace: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		if (!v.ok() || !id) return fail(400, { error: v.failMessage(), errors: v.errors });
		if (!getPlaceById(id, u.id)) return fail(404, { error: 'Not found' });
		await deletePlace(id, u.id);
		logAudit(u.id, 'place_delete', 'place', id);
		throw redirect(303, '/places');
	},

	toggleVisited: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		if (!v.ok() || !id) return fail(400, { error: v.failMessage(), errors: v.errors });
		const existing = getPlaceById(id, u.id);
		if (!existing) return fail(404, { error: 'Not found' });
		const place = setPlaceVisited(id, u.id, existing.status !== 'visited');
		logAudit(u.id, 'place_toggle_visited', 'place', id, { status: place.status });
		throw redirect(303, '/places');
	},

	toggleFavorite: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		if (!v.ok() || !id) return fail(400, { error: v.failMessage(), errors: v.errors });
		const existing = getPlaceById(id, u.id);
		if (!existing) return fail(404, { error: 'Not found' });
		updatePlace(id, u.id, { favorite: !existing.favorite });
		throw redirect(303, '/places');
	},

	uploadGpx: async ({ request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const limit = checkRateLimit(getClientAddress(), 'places:gpx');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		if (!v.ok() || !id) return fail(400, { error: v.failMessage(), errors: v.errors });
		if (!getPlaceById(id, u.id)) return fail(404, { error: 'Not found' });
		const file = f.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'A GPX file is required' });
		}
		await attachPlaceGpx(u.id, id, file);
		throw redirect(303, '/places');
	},

	removeGpx: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		if (!v.ok() || !id) return fail(400, { error: v.failMessage(), errors: v.errors });
		if (!getPlaceById(id, u.id)) return fail(404, { error: 'Not found' });
		await removePlaceGpx(u.id, id);
		throw redirect(303, '/places');
	},

	uploadGalleryImages: async ({ request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const limit = checkRateLimit(getClientAddress(), 'places:gallery');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		if (!v.ok() || !id) return fail(400, { error: v.failMessage(), errors: v.errors });
		if (!getPlaceById(id, u.id)) return fail(404, { error: 'Not found' });
		const files = collectGalleryFiles(f);
		if (!files.length) return fail(400, { error: 'At least one image file is required' });
		await addGalleryImages(u.id, 'place', id, files);
		throw redirect(303, '/places');
	},

	removeGalleryImage: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		const imageId = v.positiveId(f.get('imageId'), 'imageId');
		if (!v.ok() || !id || !imageId) return fail(400, { error: v.failMessage(), errors: v.errors });
		if (!getPlaceById(id, u.id)) return fail(404, { error: 'Not found' });
		const image = getGalleryImage(imageId);
		if (!image || image.ownerType !== 'place' || image.ownerId !== id) {
			return fail(404, { error: 'Not found' });
		}
		await removeGalleryImage(u.id, imageId);
		throw redirect(303, '/places');
	},

	moveGalleryImage: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		const imageId = v.positiveId(f.get('imageId'), 'imageId');
		if (!v.ok() || !id || !imageId) return fail(400, { error: v.failMessage(), errors: v.errors });
		const direction = String(f.get('direction') || '');
		if (direction !== 'earlier' && direction !== 'later') {
			return fail(400, { error: 'direction must be earlier or later' });
		}
		if (!getPlaceById(id, u.id)) return fail(404, { error: 'Not found' });
		const image = getGalleryImage(imageId);
		if (!image || image.ownerType !== 'place' || image.ownerId !== id) {
			return fail(404, { error: 'Not found' });
		}
		moveGalleryImage(u.id, imageId, direction);
		throw redirect(303, '/places');
	},

	setGalleryCaption: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		const imageId = v.positiveId(f.get('imageId'), 'imageId');
		const caption = v.optionalString(f.get('caption'), 'caption', { max: MAX_CAPTION_LENGTH });
		if (!v.ok() || !id || !imageId) return fail(400, { error: v.failMessage(), errors: v.errors });
		if (!getPlaceById(id, u.id)) return fail(404, { error: 'Not found' });
		const image = getGalleryImage(imageId);
		if (!image || image.ownerType !== 'place' || image.ownerId !== id) {
			return fail(404, { error: 'Not found' });
		}
		setGalleryCaption(u.id, imageId, caption ?? null);
		throw redirect(303, '/places');
	},

	saveLink: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		const label = v.requiredString(f.get('label'), 'label', { max: PLACE_LINK_LABEL_MAX });
		const notes = v.optionalString(f.get('notes'), 'notes', { max: PLACE_LINK_NOTES_MAX });
		const urlResult = httpUrl(f.get('url'), 'url');
		if (!urlResult.ok) v.addError('url', urlResult.error);
		if (!v.ok() || !id || !label || !urlResult.ok) {
			return fail(400, { error: v.failMessage(), errors: v.errors });
		}
		if (!getPlaceById(id, u.id)) return fail(404, { error: 'Not found' });
		const linkIdRaw = f.get('linkId');
		if (linkIdRaw && String(linkIdRaw).trim()) {
			const linkId = v.positiveId(linkIdRaw, 'linkId');
			if (!v.ok() || !linkId) return fail(400, { error: v.failMessage(), errors: v.errors });
			const existing = getPlaceLinkById(linkId);
			if (!existing || existing.placeId !== id) return fail(404, { error: 'Not found' });
			updatePlaceLink(u.id, id, linkId, { label, url: urlResult.value, notes: notes ?? null });
		} else {
			createPlaceLink(u.id, id, { label, url: urlResult.value, notes: notes ?? null });
		}
		throw redirect(303, '/places');
	},

	deleteLink: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		const linkId = v.positiveId(f.get('linkId'), 'linkId');
		if (!v.ok() || !id || !linkId) return fail(400, { error: v.failMessage(), errors: v.errors });
		if (!getPlaceById(id, u.id)) return fail(404, { error: 'Not found' });
		const existing = getPlaceLinkById(linkId);
		if (!existing || existing.placeId !== id) return fail(404, { error: 'Not found' });
		deletePlaceLink(u.id, id, linkId);
		throw redirect(303, '/places');
	},

	createCategory: async ({ request, locals, getClientAddress }) => {
		const u = requireUser(locals);
		const limit = checkRateLimit(getClientAddress(), 'places:category');
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfter: limit.retryAfter });
		}
		const f = await request.formData();
		const v = new Validator();
		const name = v.requiredString(f.get('name'), 'name', { max: 100 });
		const color = v.optionalString(f.get('color'), 'color', { max: 20 });
		if (!v.ok()) return fail(400, { error: v.failMessage(), errors: v.errors });
		const category = createPlaceCategory(u.id, { name: name!, color });
		logAudit(u.id, 'place_category_create', 'place_category', category.id);
		throw redirect(303, '/places');
	},

	deleteCategory: async ({ request, locals }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const v = new Validator();
		const id = v.positiveId(f.get('id'), 'id');
		if (!v.ok() || !id) return fail(400, { error: v.failMessage(), errors: v.errors });
		deletePlaceCategory(id, u.id);
		logAudit(u.id, 'place_category_delete', 'place_category', id);
		throw redirect(303, '/places');
	}
};
