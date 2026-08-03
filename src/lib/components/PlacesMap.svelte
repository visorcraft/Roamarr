<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import type { Map as MapType } from 'maplibre-gl';
	import type { FeatureCollection } from 'geojson';
	import { loadGpxTracks, type GpxTrackRef } from '$lib/gpxTracks';

	export interface PlaceMarker {
		id: number;
		name: string;
		lat: number;
		lng: number;
		color: string;
	}

	let {
		markers,
		tileUrls,
		attribution,
		tracks = []
	}: {
		markers: PlaceMarker[];
		tileUrls: string[];
		attribution: string;
		/** GPX tracks attached to places; rendered in the place's category color. */
		tracks?: GpxTrackRef[];
	} = $props();

	let container = $state<HTMLDivElement | null>(null);
	let map = $state<MapType | null>(null);
	let showTracks = $state(true);
	// Layer ids of loaded GPX tracks, for the visibility toggle.
	let trackLayerIds = $state<string[]>([]);
	// Set in onDestroy so an in-flight dynamic import that resolves after the
	// component is gone removes the map it just built instead of leaking it.
	let destroyed = false;

	function toGeoJSON(items: PlaceMarker[]): FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: items.map((m) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
				properties: { id: m.id, name: m.name, color: m.color }
			}))
		};
	}

	onMount(async () => {
		if (!browser || !container) return;

		// v6 is ESM-only: named/namespace import (no default export).
		const maplibregl = await import('maplibre-gl');
		await import('maplibre-gl/dist/maplibre-gl.css');
		// Vite must emit a self-contained worker chunk (?worker&url).
		const workerUrl = (await import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url')).default;
		maplibregl.setWorkerUrl(workerUrl);

		const instance = new maplibregl.Map({
			container,
			style: {
				version: 8,
				sources: {
					tiles: {
						type: 'raster',
						tiles: tileUrls,
						tileSize: 256,
						attribution
					}
				},
				layers: [{ id: 'tiles', type: 'raster', source: 'tiles' }]
			},
			center: [0, 20],
			zoom: 1.5
		});
		if (destroyed) {
			instance.remove();
			return;
		}

		instance.on('load', () => {
			if (destroyed) return;
			instance.addSource('places', {
				type: 'geojson',
				data: toGeoJSON(markers),
				cluster: true,
				clusterMaxZoom: 14,
				clusterRadius: 50
			});
			instance.addLayer({
				id: 'place-clusters',
				type: 'circle',
				source: 'places',
				filter: ['has', 'point_count'],
				paint: {
					'circle-color': '#1971c2',
					'circle-opacity': 0.75,
					'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24]
				}
			});
			instance.addLayer({
				id: 'place-cluster-count',
				type: 'symbol',
				source: 'places',
				filter: ['has', 'point_count'],
				layout: {
					'text-field': '{point_count_abbreviated}',
					'text-size': 12
				},
				paint: { 'text-color': '#ffffff' }
			});
			instance.addLayer({
				id: 'place-points',
				type: 'circle',
				source: 'places',
				filter: ['!', ['has', 'point_count']],
				paint: {
					'circle-color': ['get', 'color'],
					'circle-radius': 8,
					'circle-stroke-width': 2,
					'circle-stroke-color': '#ffffff'
				}
			});

			instance.on('click', 'place-points', (e) => {
				const feature = e.features?.[0];
				if (!feature || feature.geometry.type !== 'Point') return;
				const name = String(feature.properties?.name ?? '');
				new maplibregl.Popup({ closeButton: false })
					.setLngLat(feature.geometry.coordinates as [number, number])
					.setText(name)
					.addTo(instance);
			});
			instance.on('mouseenter', 'place-points', () => {
				instance.getCanvas().style.cursor = 'pointer';
			});
			instance.on('mouseleave', 'place-points', () => {
				instance.getCanvas().style.cursor = '';
			});
			instance.on('click', 'place-clusters', (e) => {
				const feature = e.features?.[0];
				if (!feature || feature.geometry.type !== 'Point') return;
				const clusterId = feature.properties?.cluster_id;
				// Capture before the async callback: the geometry type narrowing
				// does not survive into .then().
				const center = feature.geometry.coordinates as [number, number];
				const source = instance.getSource('places') as
					| import('maplibre-gl').GeoJSONSource
					| undefined;
				source?.getClusterExpansionZoom(Number(clusterId)).then((zoom) => {
					if (destroyed) return;
					instance.easeTo({ center, zoom });
				});
			});

			// Fit once markers and any GPX tracks are known, so tracks without a
			// place pin still frame the map.
			const fitBounds = () => {
				const bounds = new maplibregl.LngLatBounds();
				let has = false;
				for (const m of markers) {
					bounds.extend([m.lng, m.lat]);
					has = true;
				}
				for (const t of loadedTrackBounds) {
					bounds.extend([t.minLng, t.minLat]);
					bounds.extend([t.maxLng, t.maxLat]);
					has = true;
				}
				if (has) instance.fitBounds(bounds, { padding: 60, maxZoom: 12 });
			};
			const loadedTrackBounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }[] =
				[];

			if (tracks.length === 0) {
				fitBounds();
				return;
			}
			void (async () => {
				const loaded = await loadGpxTracks(tracks);
				if (destroyed) return;
				loaded.forEach((t, i) => {
					instance.addSource(`gpx-track-${i}`, { type: 'geojson', data: t.geojson });
					const casingId = `gpx-track-casing-${i}`;
					const lineId = `gpx-track-line-${i}`;
					instance.addLayer({
						id: casingId,
						type: 'line',
						source: `gpx-track-${i}`,
						paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.6 }
					});
					instance.addLayer({
						id: lineId,
						type: 'line',
						source: `gpx-track-${i}`,
						paint: { 'line-color': t.color, 'line-width': 2.5 }
					});
					trackLayerIds = [...trackLayerIds, casingId, lineId];
					if (t.bounds) loadedTrackBounds.push(t.bounds);
				});
				fitBounds();
			})();
		});

		map = instance;
	});

	onDestroy(() => {
		destroyed = true;
		map?.remove();
		map = null;
	});

	$effect(() => {
		const m = map;
		if (!m) return;
		const visible = showTracks ? 'visible' : 'none';
		for (const id of trackLayerIds) {
			if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', visible);
		}
	});
</script>

<div class="card relative overflow-hidden">
	<div bind:this={container} class="h-[320px] w-full sm:h-[420px]" aria-label="Map of saved places"></div>
	{#if tracks.length > 0}
		<label class="map-track-toggle">
			<input type="checkbox" bind:checked={showTracks} />
			GPX tracks
		</label>
	{/if}
</div>

<style>
	.map-track-toggle {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		border-radius: 0.375rem;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		line-height: 1;
		cursor: pointer;
	}
	.map-track-toggle:hover {
		background: rgba(0, 0, 0, 0.8);
	}
</style>
