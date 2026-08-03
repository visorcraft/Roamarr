import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { searchPlaceCatalog, resetPlaceSearchCache } from './placeSearch';
import { updateSettings } from './settings';
import { encrypt } from './crypto';

const NOMINATIM_ROW = {
	display_name: 'Eiffel Tower, Avenue Gustave Eiffel, 75007 Paris, France',
	lat: '48.8582599',
	lon: '2.2945006',
	name: 'Eiffel Tower',
	class: 'tourism',
	type: 'attraction'
};

const GOOGLE_ROW = {
	displayName: { text: 'Eiffel Tower', languageCode: 'en' },
	formattedAddress: 'Av. Gustave Eiffel, 75007 Paris, France',
	location: { latitude: 48.8582599, longitude: 2.2945006 },
	primaryType: 'tourist_attraction'
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

beforeEach(() => {
	resetPlaceSearchCache();
	updateSettings({ placeSearchProvider: 'nominatim', placeSearchGoogleApiKey: null });
});

test('parses Nominatim results and sends a policy-compliant User-Agent', async () => {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetchImpl = async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		return jsonResponse([NOMINATIM_ROW]);
	};

	const outcome = await searchPlaceCatalog('eiffel tower', { fetchImpl });
	expect(outcome.ok).toBe(true);
	if (!outcome.ok) return;
	expect(outcome.provider).toBe('nominatim');
	expect(outcome.results).toHaveLength(1);
	expect(outcome.results[0]).toMatchObject({
		name: 'Eiffel Tower',
		lat: 48.8582599,
		lng: 2.2945006,
		osmType: 'tourism/attraction'
	});

	expect(calls).toHaveLength(1);
	expect(calls[0].url).toContain('nominatim.openstreetmap.org/search');
	expect(calls[0].url).toContain('q=eiffel+tower');
	const headers = new Headers(calls[0].init?.headers);
	expect(headers.get('User-Agent')).toContain('Roamarr');
});

test('serves repeat queries from cache without a second request', async () => {
	let calls = 0;
	const fetchImpl = async () => {
		calls++;
		return jsonResponse([NOMINATIM_ROW]);
	};
	await searchPlaceCatalog('eiffel tower', { fetchImpl });
	const second = await searchPlaceCatalog('  Eiffel   Tower ', { fetchImpl });
	expect(second.ok).toBe(true);
	expect(calls).toBe(1);
});

test('short queries skip the network entirely', async () => {
	let calls = 0;
	const fetchImpl = async () => {
		calls++;
		return jsonResponse([]);
	};
	const outcome = await searchPlaceCatalog('x', { fetchImpl });
	expect(outcome).toEqual({ ok: true, results: [], provider: 'nominatim' });
	expect(calls).toBe(0);
});

test('HTTP failures degrade gracefully instead of throwing', async () => {
	const fetchImpl = async () => jsonResponse('Service Unavailable', 503);
	const outcome = await searchPlaceCatalog('paris', { fetchImpl });
	expect(outcome.ok).toBe(false);
	if (outcome.ok) return;
	expect(outcome.error).toContain('503');
});

test('network errors degrade gracefully instead of throwing', async () => {
	const fetchImpl = async () => {
		throw new TypeError('fetch failed');
	};
	const outcome = await searchPlaceCatalog('paris', { fetchImpl });
	expect(outcome).toEqual({ ok: false, error: 'Place search is unavailable' });
});

test('timeouts are reported distinctly', async () => {
	const fetchImpl = async () => {
		const err = new Error('The operation timed out');
		err.name = 'TimeoutError';
		throw err;
	};
	const outcome = await searchPlaceCatalog('paris', { fetchImpl });
	expect(outcome).toEqual({ ok: false, error: 'Place search timed out' });
});

test('malformed rows are skipped', async () => {
	const fetchImpl = async () =>
		jsonResponse([
			{ display_name: '', lat: '1', lon: '2' },
			{ display_name: 'No coords' },
			{ not: 'a row' },
			NOMINATIM_ROW
		]);
	const outcome = await searchPlaceCatalog('eiffel', { fetchImpl });
	expect(outcome.ok).toBe(true);
	if (!outcome.ok) return;
	expect(outcome.results).toHaveLength(1);
	expect(outcome.results[0].name).toBe('Eiffel Tower');
});

// --- Google Places provider ---

const GOOGLE_CONFIG = { provider: 'google' as const, googleApiKey: 'GOOGLE_TEST_KEY' };

test('google provider posts a field-masked text search with the API key header', async () => {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetchImpl = async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		return jsonResponse({ places: [GOOGLE_ROW] });
	};

	const outcome = await searchPlaceCatalog('eiffel tower', { fetchImpl, config: GOOGLE_CONFIG });
	expect(outcome.ok).toBe(true);
	if (!outcome.ok) return;
	expect(outcome.provider).toBe('google');
	expect(outcome.results).toHaveLength(1);
	expect(outcome.results[0]).toMatchObject({
		name: 'Eiffel Tower',
		displayName: 'Av. Gustave Eiffel, 75007 Paris, France',
		lat: 48.8582599,
		lng: 2.2945006,
		osmType: 'tourist_attraction'
	});

	expect(calls).toHaveLength(1);
	expect(calls[0].url).toBe('https://places.googleapis.com/v1/places:searchText');
	expect(calls[0].init?.method).toBe('POST');
	const headers = new Headers(calls[0].init?.headers);
	expect(headers.get('X-Goog-Api-Key')).toBe('GOOGLE_TEST_KEY');
	expect(headers.get('X-Goog-FieldMask')).toContain('places.displayName');
	expect(headers.get('X-Goog-FieldMask')).toContain('places.formattedAddress');
	expect(headers.get('X-Goog-FieldMask')).toContain('places.location');
	const body = JSON.parse(String(calls[0].init?.body));
	expect(body).toEqual({ textQuery: 'eiffel tower', pageSize: 8 });
});

test('google provider maps results and skips malformed rows', async () => {
	const fetchImpl = async () =>
		jsonResponse({
			places: [
				{ displayName: { text: 'No coords' }, formattedAddress: 'Somewhere' },
				{ formattedAddress: 'No name, 12345', location: { latitude: 1, longitude: 2 } },
				{ not: 'a row' },
				GOOGLE_ROW
			]
		});
	const outcome = await searchPlaceCatalog('eiffel', { fetchImpl, config: GOOGLE_CONFIG });
	expect(outcome.ok).toBe(true);
	if (!outcome.ok) return;
	expect(outcome.results).toHaveLength(1);
	expect(outcome.results[0].name).toBe('Eiffel Tower');
});

test('google 403 is reported as an API key problem, not a generic failure', async () => {
	const fetchImpl = async () => jsonResponse({ error: { message: 'API key not valid' } }, 403);
	const outcome = await searchPlaceCatalog('paris', { fetchImpl, config: GOOGLE_CONFIG });
	expect(outcome).toEqual({ ok: false, error: 'Google Places rejected the API key (HTTP 403)' });
});

test('google timeouts are reported distinctly', async () => {
	const fetchImpl = async () => {
		const err = new Error('The operation timed out');
		err.name = 'TimeoutError';
		throw err;
	};
	const outcome = await searchPlaceCatalog('paris', { fetchImpl, config: GOOGLE_CONFIG });
	expect(outcome).toEqual({ ok: false, error: 'Place search timed out' });
});

test('malformed JSON from google degrades gracefully', async () => {
	const fetchImpl = async () =>
		new Response('<html>not json</html>', { status: 200, headers: { 'content-type': 'text/html' } });
	const outcome = await searchPlaceCatalog('paris', { fetchImpl, config: GOOGLE_CONFIG });
	expect(outcome).toEqual({ ok: false, error: 'Place search is unavailable' });
});

test('google selected without a key falls back to nominatim with a warning', async () => {
	const calls: string[] = [];
	const fetchImpl = async (url: string) => {
		calls.push(url);
		return jsonResponse([NOMINATIM_ROW]);
	};
	const outcome = await searchPlaceCatalog('eiffel tower', {
		fetchImpl,
		config: { provider: 'google', googleApiKey: null }
	});
	expect(outcome.ok).toBe(true);
	if (!outcome.ok) return;
	expect(outcome.provider).toBe('nominatim');
	expect(outcome.warning).toContain('Google Places');
	expect(outcome.results).toHaveLength(1);
	expect(calls).toHaveLength(1);
	expect(calls[0]).toContain('nominatim.openstreetmap.org');
});

test('provider and encrypted key come from instance settings', async () => {
	updateSettings({ placeSearchProvider: 'google', placeSearchGoogleApiKey: encrypt('STORED_KEY') });
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetchImpl = async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		return jsonResponse({ places: [GOOGLE_ROW] });
	};
	const outcome = await searchPlaceCatalog('eiffel tower', { fetchImpl });
	expect(outcome.ok).toBe(true);
	if (!outcome.ok) return;
	expect(outcome.provider).toBe('google');
	expect(calls).toHaveLength(1);
	expect(new Headers(calls[0].init?.headers).get('X-Goog-Api-Key')).toBe('STORED_KEY');
});

test('provider caches are separate per provider', async () => {
	const fetchImpl = async (url: string) => {
		if (url.includes('googleapis')) return jsonResponse({ places: [GOOGLE_ROW] });
		return jsonResponse([NOMINATIM_ROW]);
	};
	await searchPlaceCatalog('eiffel tower', { fetchImpl });
	const second = await searchPlaceCatalog('eiffel tower', { fetchImpl, config: GOOGLE_CONFIG });
	expect(second.ok).toBe(true);
	if (!second.ok) return;
	// Not served from the Nominatim cache: Google was queried and its result shape returned.
	expect(second.provider).toBe('google');
	expect(second.results[0].displayName).toBe('Av. Gustave Eiffel, 75007 Paris, France');
});
