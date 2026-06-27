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
		default:
			return '';
	}
}

export function providerNeedsApiKey(provider: MapTileProvider): boolean {
	return ['maptiler', 'stadia', 'thunderforest', 'jawg', 'protomaps'].includes(provider);
}
