<script lang="ts">
	import { setContext, type Snippet } from 'svelte';
	import CardSelect from '$lib/components/CardSelect.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { SegmentFormTrip } from '$lib/server/segmentNewPage';
	import { SEGMENT_CITY_DEFAULTS_KEY, type SegmentCityDefaults } from './segmentCityDefaults';

	let {
		trip,
		label,
		form,
		cards,
		children
	}: {
		trip: SegmentFormTrip | { id: number; name: string };
		label: string;
		form?: { error?: string; errors?: Record<string, string> } | null;
		cards?: { id: number; nickname: string; network: string; last4: string | null }[];
		children: Snippet;
	} = $props();

	// Prefill country/city/coords on child forms from the trip destination when set.
	// Getters so we always read current trip props (avoids state_referenced_locally).
	const cityDefaults: SegmentCityDefaults = {
		get countryCode() {
			return (trip as SegmentFormTrip).destinationCountryCode ?? '';
		},
		get admin1Code() {
			return (trip as SegmentFormTrip).destinationAdmin1Code ?? '';
		},
		get cityName() {
			return (trip as SegmentFormTrip).destinationCityName ?? '';
		},
		get cityLat() {
			return (trip as SegmentFormTrip).destinationCityLat ?? null;
		},
		get cityLng() {
			return (trip as SegmentFormTrip).destinationCityLng ?? null;
		}
	};
	setContext(SEGMENT_CITY_DEFAULTS_KEY, cityDefaults);
</script>

<header class="page-header">
	<div>
		<a href={`/trips/${trip.id}`} class="back-link">
			<Icon name="back" class="h-4 w-4" />
			Back to {trip.name}
		</a>
		<h1 class="page-title">Add {label.toLowerCase()}</h1>
		<p class="page-subtitle">Fill in the details below.</p>
	</div>
	<a href={`/trips/${trip.id}/segments/new`} class="btn btn-ghost">Back</a>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form method="POST" enctype="multipart/form-data" class="grid gap-4 sm:grid-cols-2">
		{#if form?.error}<p class="notice notice-error sm:col-span-2">{form.error}</p>{/if}

		{@render children()}

		{#if cards?.length}
			<CardSelect {cards} name="cardId" errors={form?.errors} />
		{/if}

		<div class="field sm:col-span-2">
			<label class="label" for="segment-documents">Documents (optional)</label>
			<p class="mb-2 text-sm text-muted">
				Attach PDFs or images such as QR codes, vouchers, or booking confirmations (JPEG, PNG, WebP, or PDF, max 10&nbsp;MB each).
			</p>
			<input
				id="segment-documents"
				name="documents"
				type="file"
				multiple
				accept="image/jpeg,image/png,image/webp,application/pdf"
				class="input"
			/>
		</div>

		<div class="form-actions sm:col-span-2">
			<a href={`/trips/${trip.id}/segments/new`} class="btn btn-ghost">Back</a>
			<div class="flex flex-wrap gap-2">
				<a href={`/trips/${trip.id}`} class="btn btn-ghost">Cancel</a>
				<button class="btn btn-primary">Save</button>
			</div>
		</div>
	</form>
</section>
