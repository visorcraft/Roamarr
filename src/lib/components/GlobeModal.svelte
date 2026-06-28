<script lang="ts">
	import { browser } from '$app/environment';

	let {
		open = $bindable(false),
		lat,
		lng,
		cityName
	}: {
		open?: boolean;
		lat: number;
		lng: number;
		cityName: string;
	} = $props();

	let dialogEl = $state<HTMLDialogElement | null>(null);
	let container = $state<HTMLDivElement | null>(null);
	// EarthCityGlobe is a vendored JS module loaded only in the browser; keep it untyped.
	let globe: { dispose?: () => void } | null = null;
	let loading = $state(false);
	let readout = $state('');

	async function mountGlobe() {
		if (!browser || !container || globe) return;
		loading = true;
		readout = '';
		try {
			const { EarthCityGlobe } = await import('$lib/EarthCityGlobe.js');
			const g = await EarthCityGlobe.create({
				container,
				textures: { day: '/api/maps/texture' },
				countriesGeoJsonUrl: '/maps/countries.geojson',
				maxLabels: 200,
				labelMinPopulation: 0
			});
			try {
				const res = await fetch(`/api/cities/globe?lat=${lat}&lng=${lng}`);
				if (res.ok) g.setCities((await res.json()).cities);
			} catch {
				// Globe still renders (texture + borders) without city dots.
			}
			g.flyTo(lat, lng, 1.8);
			g.on('select', (e: CustomEvent) => {
				const d = e.detail;
				readout =
					d.kind === 'city'
						? `${d.city.name} — ${d.city.lat.toFixed(3)}, ${d.city.lon.toFixed(3)}`
						: `${d.lat.toFixed(3)}, ${d.lon.toFixed(3)}`;
			});
			globe = g;
		} finally {
			loading = false;
		}
	}

	function unmountGlobe() {
		globe?.dispose?.();
		globe = null;
	}

	$effect(() => {
		const d = dialogEl;
		if (!d) return;
		if (open && !d.open) {
			d.showModal();
			void mountGlobe();
		} else if (!open && d.open) {
			d.close();
		}
	});

	function handleClose() {
		open = false;
		unmountGlobe();
	}

	function requestClose() {
		dialogEl?.close();
	}
</script>

<dialog
	bind:this={dialogEl}
	class="globe-dialog"
	onclose={handleClose}
	onclick={(e) => {
		if (e.target === dialogEl) requestClose();
	}}
>
	<div class="card globe-modal">
		<div class="globe-modal-head">
			<h2 class="section-title">{cityName}</h2>
			<button class="btn btn-secondary" type="button" onclick={requestClose} aria-label="Close globe">✕</button>
		</div>
		<div class="globe-modal-stage" bind:this={container}>
			{#if loading}<p class="globe-modal-loading">Loading globe…</p>{/if}
		</div>
		<p class="globe-modal-readout">
			{readout || 'Drag to rotate · scroll to zoom · click a city or anywhere on Earth'}
		</p>
	</div>
</dialog>

<style>
	.globe-dialog {
		position: fixed;
		inset: 0;
		margin: auto;
		width: min(92vw, 960px);
		height: fit-content;
		max-width: 92vw;
		max-height: 92vh;
		padding: 0;
		border: none;
		background: transparent;
		overflow: visible;
	}
	.globe-dialog::backdrop {
		background: rgba(0, 0, 0, 0.7);
	}
	.globe-modal {
		width: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		padding: 0;
	}
	.globe-modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 0.9rem;
		border-bottom: 1px solid var(--theme-line);
	}
	.globe-modal-stage {
		position: relative;
		width: 100%;
		height: min(70vh, 620px);
	}
	.globe-modal-loading {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.9rem;
	}
	.globe-modal-readout {
		padding: 0.5rem 0.9rem;
		font-size: 0.85rem;
		border-top: 1px solid var(--theme-line);
	}
</style>
