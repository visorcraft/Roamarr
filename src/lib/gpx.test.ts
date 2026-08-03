// @vitest-environment jsdom
import { test, expect, describe } from 'vitest';
import type { MultiLineString } from 'geojson';
import { parseGpx, GPX_MAX_BYTES } from './gpx';

const TRACK = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
	<trk>
		<name>Morning hike</name>
		<trkseg>
			<trkpt lat="46.0" lon="7.0"><ele>1000</ele></trkpt>
			<trkpt lat="46.0" lon="7.1"><ele>1010</ele></trkpt>
		</trkseg>
		<trkseg>
			<trkpt lat="46.1" lon="7.1" />
			<trkpt lat="46.1" lon="7.2" />
		</trkseg>
	</trk>
</gpx>`;

describe('parseGpx', () => {
	test('parses a multi-segment track into a MultiLineString with stats and bounds', () => {
		const { geojson, bounds, stats } = parseGpx(TRACK);
		expect(geojson.features).toHaveLength(1);
		const f = geojson.features[0]!;
		expect(f.geometry.type).toBe('MultiLineString');
		expect(f.properties).toMatchObject({ kind: 'track', name: 'Morning hike' });
		const coords = (f.geometry as MultiLineString).coordinates;
		expect(coords).toHaveLength(2);
		expect(coords[0]![0]).toEqual([7.0, 46.0]);
		expect(stats.points).toBe(4);
		// Two within-segment legs of 0.1° longitude at lat ~46 (≈7.7 km each).
		expect(stats.distanceM).toBeGreaterThan(15_000);
		expect(stats.distanceM).toBeLessThan(16_000);
		expect(bounds).toEqual({ minLat: 46.0, minLng: 7.0, maxLat: 46.1, maxLng: 7.2 });
	});

	test('parses a route into a LineString', () => {
		const gpx = `<gpx version="1.1" creator="t">
			<rte><name>Scenic drive</name>
				<rtept lat="48.0" lon="2.0" />
				<rtept lat="48.0" lon="2.1" />
			</rte>
		</gpx>`;
		const { geojson, stats } = parseGpx(gpx);
		expect(geojson.features).toHaveLength(1);
		expect(geojson.features[0]!.geometry.type).toBe('LineString');
		expect(geojson.features[0]!.properties).toMatchObject({ kind: 'route', name: 'Scenic drive' });
		expect(stats.points).toBe(2);
		// 0.1° longitude at lat 48 is ≈7.45 km.
		expect(stats.distanceM).toBeGreaterThan(7_000);
		expect(stats.distanceM).toBeLessThan(7_800);
	});

	test('parses waypoints into Point features with name and ele', () => {
		const gpx = `<gpx version="1.1" creator="t">
			<wpt lat="46.5" lon="8.0"><name>Summit</name><ele>3000.5</ele></wpt>
			<wpt lat="46.6" lon="8.1" />
		</gpx>`;
		const { geojson, stats, bounds } = parseGpx(gpx);
		expect(geojson.features).toHaveLength(2);
		const first = geojson.features[0]!;
		expect(first.geometry).toEqual({ type: 'Point', coordinates: [8.0, 46.5] });
		expect(first.properties).toEqual({ kind: 'waypoint', name: 'Summit', ele: 3000.5 });
		expect(geojson.features[1]!.properties).toEqual({ kind: 'waypoint', name: null, ele: null });
		expect(stats.points).toBe(2);
		expect(stats.distanceM).toBe(0);
		expect(bounds).toEqual({ minLat: 46.5, minLng: 8.0, maxLat: 46.6, maxLng: 8.1 });
	});

	test('a single-segment track stays a LineString', () => {
		const gpx = `<gpx><trk><trkseg>
			<trkpt lat="1" lon="2" /><trkpt lat="1.1" lon="2.1" />
		</trkseg></trk></gpx>`;
		const { geojson } = parseGpx(gpx);
		expect(geojson.features[0]!.geometry.type).toBe('LineString');
	});

	test('skips points with missing or invalid coordinates', () => {
		const gpx = `<gpx>
			<wpt lat="46.5" lon="8.0" />
			<wpt lon="8.1" />
			<wpt lat="999" lon="8.2" />
			<wpt lat="abc" lon="8.3" />
		</gpx>`;
		const { geojson, stats, bounds } = parseGpx(gpx);
		expect(geojson.features).toHaveLength(1);
		expect(stats.points).toBe(1);
		expect(bounds).toEqual({ minLat: 46.5, minLng: 8.0, maxLat: 46.5, maxLng: 8.0 });
	});

	test('empty gpx document yields no features and null bounds', () => {
		const { geojson, bounds, stats } = parseGpx('<gpx version="1.1" creator="t" />');
		expect(geojson.features).toHaveLength(0);
		expect(bounds).toBeNull();
		expect(stats).toEqual({ points: 0, distanceM: 0 });
	});

	test('rejects malformed XML', () => {
		expect(() => parseGpx('<gpx><trk>')).toThrow(/malformed XML/);
	});

	test('rejects non-gpx root elements', () => {
		expect(() => parseGpx('<html><body>x</body></html>')).toThrow(/not <gpx>/);
		expect(() => parseGpx('<kml xmlns="http://www.opengis.net/kml/2.2" />')).toThrow(/not <gpx>/);
	});

	test('rejects oversized input', () => {
		const big = `<gpx>${' '.repeat(GPX_MAX_BYTES)}</gpx>`;
		expect(() => parseGpx(big)).toThrow(/too large/);
	});

	test('XXE-style payloads are never resolved', () => {
		// DOMParser does not fetch external entities or DTDs; jsdom rejects the
		// document outright. Either way the file content can never leak in.
		const xxe = `<?xml version="1.0"?>
			<!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
			<gpx><wpt lat="1" lon="2"><name>&xxe;</name></wpt></gpx>`;
		expect(() => parseGpx(xxe)).toThrow();
	});
});
