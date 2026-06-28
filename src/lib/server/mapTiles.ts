import { getSettings } from './settings';
import { decrypt } from './crypto';

export const MAP_TILE_PROVIDERS = [
	'openstreetmap',
	'carto',
	'maptiler',
	'stadia',
	'thunderforest',
	'jawg',
	'protomaps',
	'custom'
] as const;

export type MapTileProvider = (typeof MAP_TILE_PROVIDERS)[number];

export function defaultTileUrl(provider: MapTileProvider): string | null {
	switch (provider) {
		case 'openstreetmap':
			return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
		case 'carto':
			return 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
		default:
			return null;
	}
}

export function defaultTileAttribution(provider: MapTileProvider): string {
	switch (provider) {
		case 'openstreetmap':
			return '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
		case 'carto':
			return '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>';
		case 'maptiler':
			return '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
		case 'stadia':
			return '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
		case 'thunderforest':
			return '&copy; <a href="https://www.thunderforest.com/">Thunderforest</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
		case 'jawg':
			return '&copy; <a href="https://www.jawg.io/">Jawg Maps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
		case 'protomaps':
			return '&copy; <a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
		default:
			return '';
	}
}

export function providerNeedsApiKey(provider: MapTileProvider): boolean {
	return ['maptiler', 'stadia', 'thunderforest', 'jawg', 'protomaps'].includes(provider);
}

export interface ResolvedTileConfig {
	provider: string;
	tileUrls: string[];
	attribution: string;
	apiKey: string | null;
}

function expandTileUrl(url: string): string[] {
	if (!url.includes('{s}')) return [url];
	return ['a', 'b', 'c', 'd'].map((s) => url.replace('{s}', s));
}

// Origins (scheme://host) the browser must reach for the configured map tiles, for the
// CSP allow-list. Origin only — never the full URL — so a {key} API key in the path/query
// is never copied into a response header.
export function tileCspOrigins(): string[] {
	try {
		const s = getSettings();
		const provider = s.mapsTileProvider as MapTileProvider;
		const rawUrl = s.mapsTileUrl || defaultTileUrl(provider);
		if (!rawUrl) return [];
		const candidates = rawUrl.includes('{s}')
			? ['a', 'b', 'c', 'd'].map((sub) => rawUrl.replace('{s}', sub))
			: [rawUrl];
		const origins = new Set<string>();
		for (const u of candidates) {
			try {
				origins.add(new URL(u).origin);
			} catch {
				// Unparseable template (e.g. an unexpanded {s} left in the host) — skip it.
			}
		}
		return [...origins];
	} catch {
		return [];
	}
}

export function resolveTileConfig(): ResolvedTileConfig | null {
	const s = getSettings();
	const provider = s.mapsTileProvider as MapTileProvider;
	const rawUrl = s.mapsTileUrl || defaultTileUrl(provider);
	const attribution = s.mapsTileAttribution || defaultTileAttribution(provider);
	if (!rawUrl) return null;
	const apiKey = s.mapsTileApiKey ? decrypt(s.mapsTileApiKey) : null;
	const url = apiKey ? rawUrl.replace('{key}', apiKey) : rawUrl;
	return {
		provider,
		tileUrls: expandTileUrl(url),
		attribution: `${attribution} | City data © <a href="https://www.geonames.org/">GeoNames.org</a>, CC-BY 4.0`,
		apiKey
	};
}
