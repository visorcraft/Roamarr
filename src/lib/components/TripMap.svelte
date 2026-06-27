<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import type { Map as MapType } from 'maplibre-gl';

	let {
		lat,
		lng,
		cityName,
		tileUrls,
		attribution
	}: {
		lat: number;
		lng: number;
		cityName: string;
		tileUrls: string[];
		attribution: string;
	} = $props();

	let container = $state<HTMLDivElement | null>(null);
	let map = $state<MapType | null>(null);

	onMount(async () => {
		if (!browser || !container) return;

		const maplibregl = (await import('maplibre-gl')).default as typeof import('maplibre-gl');
		await import('maplibre-gl/dist/maplibre-gl.css');

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
		new maplibregl.Marker().setLngLat([lng, lat]).addTo(instance);
		map = instance;
	});

	onDestroy(() => {
		map?.remove();
		map = null;
	});

	$effect(() => {
		if (!map) return;
		map.setCenter([lng, lat]);
	});
</script>

<div class="card overflow-hidden">
	<div bind:this={container} class="h-[200px] w-full sm:h-[240px]" aria-label={`Map centered on ${cityName}`}></div>
</div>
