import type { FeatureCollection } from 'geojson';
import { parseGpx, type GpxBounds } from '$lib/gpx';

/** A GPX track to render on a map: same-origin download URL plus styling. */
export interface GpxTrackRef {
	url: string;
	color: string;
	label: string;
}

export interface LoadedGpxTrack extends GpxTrackRef {
	geojson: FeatureCollection;
	bounds: GpxBounds | null;
}

/**
 * Fetch and parse a GPX track for map rendering. Returns null when the file
 * is missing or unparsable — a broken upload must never break the whole map.
 */
export async function loadGpxTrack(ref: GpxTrackRef): Promise<LoadedGpxTrack | null> {
	try {
		const res = await fetch(ref.url);
		if (!res.ok) return null;
		const { geojson, bounds } = parseGpx(await res.text());
		return { ...ref, geojson, bounds };
	} catch {
		return null;
	}
}

export async function loadGpxTracks(refs: GpxTrackRef[]): Promise<LoadedGpxTrack[]> {
	const loaded = await Promise.all(refs.map(loadGpxTrack));
	return loaded.filter((t): t is LoadedGpxTrack => t != null);
}
