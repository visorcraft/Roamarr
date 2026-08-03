/**
 * Server-side place search, used to prefill the saved-place form. Two
 * providers sit behind the same `searchPlaceCatalog` signature:
 *
 * - OpenStreetMap Nominatim (default). Policy compliance: identifies with a
 *   descriptive User-Agent, serializes requests to at most 1 per second,
 *   caches recent queries in memory, and fails gracefully.
 * - Google Places API (New) Text Search, enabled when the admin selects it on
 *   the Maps settings tab and stores an API key (encrypted at rest). Sends the
 *   key via the `X-Goog-Api-Key` header with a narrow field mask.
 *
 * Both providers share the serialized queue and the in-memory cache so the
 * caller never cares which one is active, and both honor the never-throws
 * contract (offline/timeout => ok:false). When Google is selected but no key
 * is configured, the search falls back to Nominatim and reports a `warning`.
 */

export const PLACE_SEARCH_PROVIDERS = ['nominatim', 'google'] as const;
export type PlaceSearchProvider = (typeof PLACE_SEARCH_PROVIDERS)[number];

export interface PlaceSearchResult {
	name: string;
	displayName: string;
	lat: number;
	lng: number;
	/** OSM class/type ("tourism/museum") or Google primaryType — a category hint. */
	osmType: string | null;
}

export type PlaceSearchOutcome =
	| { ok: true; results: PlaceSearchResult[]; provider: PlaceSearchProvider; warning?: string }
	| { ok: false; error: string };

export interface PlaceSearchConfig {
	provider: PlaceSearchProvider;
	googleApiKey: string | null;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const GOOGLE_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_FIELD_MASK = 'places.displayName,places.formattedAddress,places.location,places.primaryType';
const USER_AGENT = 'Roamarr (self-hosted travel organizer; https://github.com/visorcraft/roamarr)';
const REQUEST_TIMEOUT_MS = 5000;
const GOOGLE_TIMEOUT_MS = 8000;
const MIN_INTERVAL_MS = 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

const GOOGLE_FALLBACK_WARNING =
	'Google Places is selected but no API key is configured; results come from OpenStreetMap Nominatim.';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const cache = new Map<string, { at: number; results: PlaceSearchResult[] }>();

// Serialized request queue enforcing at most 1 req/s for either provider
// (required by the Nominatim usage policy, harmless for Google).
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function normalizeQuery(query: string): string {
	return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function cachedResults(key: string): PlaceSearchResult[] | null {
	const hit = cache.get(key);
	if (!hit) return null;
	if (Date.now() - hit.at > CACHE_TTL_MS) {
		cache.delete(key);
		return null;
	}
	return hit.results;
}

function storeResults(key: string, results: PlaceSearchResult[]) {
	if (cache.size >= CACHE_MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, { at: Date.now(), results });
}

async function waitTurn(): Promise<void> {
	const turn = queue.then(async () => {
		const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		lastRequestAt = Date.now();
	});
	// Keep the chain alive even if a caller's turn rejects.
	queue = turn.catch(() => {});
	await turn;
}

// Reads the admin-configured provider from instance settings. Dynamic import
// avoids a hard module cycle with the db handle, and any failure (e.g. an
// unreadable database) degrades to the default Nominatim provider.
async function resolvePlaceSearchConfig(): Promise<PlaceSearchConfig> {
	try {
		const { getSettings } = await import('./settings');
		const { decrypt } = await import('./crypto');
		const s = getSettings();
		return {
			provider: s.placeSearchProvider === 'google' ? 'google' : 'nominatim',
			googleApiKey: s.placeSearchGoogleApiKey ? decrypt(s.placeSearchGoogleApiKey) : null
		};
	} catch {
		return { provider: 'nominatim', googleApiKey: null };
	}
}

interface NominatimRow {
	display_name?: string;
	lat?: string;
	lon?: string;
	name?: string;
	class?: string;
	type?: string;
}

function parseNominatimResults(body: unknown, limit: number): PlaceSearchResult[] {
	if (!Array.isArray(body)) return [];
	const out: PlaceSearchResult[] = [];
	for (const row of body as NominatimRow[]) {
		const lat = Number(row?.lat);
		const lng = Number(row?.lon);
		const displayName = typeof row?.display_name === 'string' ? row.display_name : '';
		if (!displayName || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
		out.push({
			name: (typeof row?.name === 'string' && row.name) || displayName.split(',')[0]!.trim(),
			displayName,
			lat,
			lng,
			osmType: row?.class && row?.type ? `${row.class}/${row.type}` : null
		});
		if (out.length >= limit) break;
	}
	return out;
}

interface GooglePlaceRow {
	displayName?: { text?: string };
	formattedAddress?: string;
	location?: { latitude?: number; longitude?: number };
	primaryType?: string;
}

function parseGoogleResults(body: unknown, limit: number): PlaceSearchResult[] {
	const places = (body as { places?: unknown } | null)?.places;
	if (!Array.isArray(places)) return [];
	const out: PlaceSearchResult[] = [];
	for (const row of places as GooglePlaceRow[]) {
		const name = typeof row?.displayName?.text === 'string' ? row.displayName.text : '';
		const displayName = typeof row?.formattedAddress === 'string' ? row.formattedAddress : '';
		const lat = Number(row?.location?.latitude);
		const lng = Number(row?.location?.longitude);
		if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
		out.push({
			name,
			displayName: displayName || name,
			lat,
			lng,
			osmType: typeof row?.primaryType === 'string' && row.primaryType ? row.primaryType : null
		});
		if (out.length >= limit) break;
	}
	return out;
}

function classifyError(e: unknown, status?: number): PlaceSearchOutcome {
	if (status !== undefined) {
		return { ok: false, error: `Place search failed (HTTP ${status})` };
	}
	const aborted = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
	return { ok: false, error: aborted ? 'Place search timed out' : 'Place search is unavailable' };
}

async function searchNominatim(
	key: string,
	limit: number,
	fetchImpl: FetchLike
): Promise<PlaceSearchResult[] | PlaceSearchOutcome> {
	const url = new URL(NOMINATIM_URL);
	url.searchParams.set('q', key);
	url.searchParams.set('format', 'jsonv2');
	url.searchParams.set('limit', String(limit));
	const res = await fetchImpl(url.toString(), {
		headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (!res.ok) return classifyError(null, res.status);
	return parseNominatimResults(await res.json(), limit);
}

async function searchGoogle(
	key: string,
	limit: number,
	apiKey: string,
	fetchImpl: FetchLike
): Promise<PlaceSearchResult[] | PlaceSearchOutcome> {
	const res = await fetchImpl(GOOGLE_TEXT_SEARCH_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			'X-Goog-Api-Key': apiKey,
			'X-Goog-FieldMask': GOOGLE_FIELD_MASK
		},
		body: JSON.stringify({ textQuery: key, pageSize: limit }),
		signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS)
	});
	if (!res.ok) {
		if (res.status === 403) return { ok: false, error: 'Google Places rejected the API key (HTTP 403)' };
		return classifyError(null, res.status);
	}
	return parseGoogleResults(await res.json(), limit);
}

export async function searchPlaceCatalog(
	query: string,
	opts: { limit?: number; fetchImpl?: FetchLike; config?: PlaceSearchConfig } = {}
): Promise<PlaceSearchOutcome> {
	const key = normalizeQuery(query);
	const config = opts.config ?? (await resolvePlaceSearchConfig());
	const missingKey = config.provider === 'google' && !config.googleApiKey;
	const provider: PlaceSearchProvider = missingKey ? 'nominatim' : config.provider;
	const warning = missingKey ? GOOGLE_FALLBACK_WARNING : undefined;
	if (key.length < 2) return { ok: true, results: [], provider, ...(warning ? { warning } : {}) };
	const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);

	const cacheKey = `${provider}:${key}`;
	const cached = cachedResults(cacheKey);
	if (cached) return { ok: true, results: cached.slice(0, limit), provider, ...(warning ? { warning } : {}) };

	const fetchImpl = opts.fetchImpl ?? fetch;
	try {
		await waitTurn();
		const searched =
			provider === 'google'
				? await searchGoogle(key, limit, config.googleApiKey!, fetchImpl)
				: await searchNominatim(key, limit, fetchImpl);
		if (!Array.isArray(searched)) return searched;
		storeResults(cacheKey, searched);
		return { ok: true, results: searched, provider, ...(warning ? { warning } : {}) };
	} catch (e) {
		return classifyError(e);
	}
}

/** Test hook: drop the in-memory cache between runs. */
export function resetPlaceSearchCache(): void {
	cache.clear();
}
