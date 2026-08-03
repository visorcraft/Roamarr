<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import type { Map as MapType } from 'maplibre-gl';
	import { loadGpxTracks, type GpxTrackRef } from '$lib/gpxTracks';

	let {
		lat,
		lng,
		cityName,
		tileUrls,
		attribution,
		onExpand,
		fill = false,
		tracks = []
	}: {
		lat: number;
		lng: number;
		cityName: string;
		tileUrls: string[];
		attribution: string;
		onExpand?: () => void;
		fill?: boolean;
		/** GPX tracks attached to the trip's documents, colored per segment. */
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
			center: [lng, lat],
			zoom: 12
		});
		if (destroyed) {
			instance.remove();
			return;
		}
		new maplibregl.Marker().setLngLat([lng, lat]).addTo(instance);
		map = instance;

		if (tracks.length === 0) return;
		// Layers can only be added once the style has finished loading.
		const styleReady = new Promise<void>((resolve) => {
			if (instance.loaded()) resolve();
			else instance.once('load', () => resolve());
		});
		const [loaded] = await Promise.all([loadGpxTracks(tracks), styleReady]);
		if (destroyed) return;
		const bounds = new maplibregl.LngLatBounds();
		let hasBounds = false;
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
			if (t.bounds) {
				bounds.extend([t.bounds.minLng, t.bounds.minLat]);
				bounds.extend([t.bounds.maxLng, t.bounds.maxLat]);
				hasBounds = true;
			}
		});
		if (hasBounds) instance.fitBounds(bounds, { padding: 40, maxZoom: 14 });
	});

	onDestroy(() => {
		destroyed = true;
		map?.remove();
		map = null;
	});

	$effect(() => {
		if (!map) return;
		map.setCenter([lng, lat]);
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

<div class={fill ? 'relative h-full w-full overflow-hidden' : 'card relative overflow-hidden'}>
	<div
		bind:this={container}
		class={fill ? 'h-full w-full' : 'h-[200px] w-full sm:h-[240px]'}
		aria-label={`Map centered on ${cityName}`}
	></div>
	{#if tracks.length > 0}
		<label class="map-track-toggle">
			<input type="checkbox" bind:checked={showTracks} />
			GPX tracks
		</label>
	{/if}
	{#if onExpand}
		<button
			type="button"
			class="globe-open {fill ? 'globe-open--fill' : ''}"
			onclick={onExpand}
			aria-label={`Open 3D globe centered on ${cityName}`}
		>
			<span class="globe-open-chip">🌐 Globe view</span>
		</button>
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
	.globe-open {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		padding: 0.5rem;
		background: transparent;
		border: 0;
		cursor: pointer;
	}
	/* In the hero background, keep the hint clear of the top-right Actions button. */
	.globe-open--fill {
		align-items: flex-end;
		justify-content: flex-start;
		padding: 0.6rem 0.75rem;
	}
	.globe-open-chip {
		border-radius: 0.375rem;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		padding: 0.2rem 0.5rem;
		font-size: 0.75rem;
		line-height: 1;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
	}
	.globe-open:hover .globe-open-chip {
		background: rgba(0, 0, 0, 0.8);
	}
</style>
