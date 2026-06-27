<script lang="ts">
	import { onMount } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

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
	let map = $state<maplibregl.Map | null>(null);

	$effect(() => {
		if (!container || map) return;
		map = new maplibregl.Map({
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
		new maplibregl.Marker().setLngLat([lng, lat]).addTo(map);
		return () => {
			map?.remove();
			map = null;
		};
	});
</script>

<div class="card overflow-hidden">
	<div bind:this={container} class="h-[200px] w-full sm:h-[240px]" aria-label={`Map centered on ${cityName}`}></div>
</div>
