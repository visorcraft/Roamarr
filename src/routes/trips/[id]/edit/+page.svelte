<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import { TRIP_STATUSES, type TripStatus } from '$lib/tripStatus';
	import { COUNTRIES } from '$lib/countries';
	import CityAutocomplete from '$lib/components/segments/CityAutocomplete.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import type { Visibility } from '$lib/server/repositories/tripsRepo';

	let { data, form }: { data: { trip: { id: number; name: string; destinationCountryCode: string | null; destinationCityName: string | null; destinationCityLat: number | null; destinationCityLng: number | null; startDate: string | null; endDate: string | null; notes: string | null; tags: string; status: TripStatus; baseCurrency: string; defaultVisibility: Visibility }; owner: boolean }; form?: { error?: string; errors?: Record<string, string> } } = $props();
	let submitting = $state(false);
	let destinationCountryCode = $state('');
	let isDirty = $state(false);
	$effect(() => {
		destinationCountryCode = data.trip.destinationCountryCode ?? '';
	});

	const statusLabel: Record<TripStatus, string> = {
		planning: 'Planning',
		booked: 'Booked',
		active: 'Active',
		completed: 'Completed'
	};

	function tagString(raw: string): string {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) return parsed.join(', ');
		} catch {
			// ignore
		}
		return '';
	}
</script>

<header>
	<div class="min-w-0">
		<h1 class="page-title truncate">Edit trip</h1>
		<p class="page-subtitle">Update the details for {data.trip.name}.</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form method="POST" action="?/save" class="grid gap-4 sm:grid-cols-2" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting} oninput={() => (isDirty = true)}>
		{#if form?.error}<p class="notice notice-error sm:col-span-2">{form.error}</p>{/if}

		<TextField name="name" label="Trip name" value={data.trip.name} required disabled={submitting} errors={form?.errors ?? {}} />
		<div class="field">
			<label class="label" for="defaultVisibility">Default visibility</label>
			<select id="defaultVisibility" name="defaultVisibility" class="select {form?.errors?.defaultVisibility ? 'input-error' : ''}" disabled={submitting}>
				<option value="private" selected={data.trip.defaultVisibility === 'private'}>Private</option>
				<option value="groups" selected={data.trip.defaultVisibility === 'groups'}>Groups</option>
				<option value="public" selected={data.trip.defaultVisibility === 'public'}>Public</option>
			</select>
			{#if form?.errors?.defaultVisibility}<p class="field-error">{form.errors.defaultVisibility}</p>{/if}
		</div>
		<div class="field">
			<label class="label" for="destinationCountryCode">Destination country</label>
			<select
				id="destinationCountryCode"
				name="destinationCountryCode"
				class="input {form?.errors?.destinationCountryCode ? 'input-error' : ''}"
				bind:value={destinationCountryCode}
				disabled={submitting}
			>
				<option value="">Select country</option>
				{#each COUNTRIES as c}
					<option value={c.code} selected={c.code === destinationCountryCode}>{c.name}</option>
				{/each}
			</select>
			{#if form?.errors?.destinationCountryCode}<p class="field-error">{form.errors.destinationCountryCode}</p>{/if}
		</div>
		<div class="field">
			<CityAutocomplete
				countryCode={destinationCountryCode}
				name="destinationCityName"
				value={data.trip.destinationCityName ?? ''}
				latName="destinationCityLat"
				lngName="destinationCityLng"
				errors={form?.errors ?? {}}
				disabled={submitting}
			/>
		</div>
		<TextField name="startDate" label="Start date" type="date" value={data.trip.startDate ?? ''} disabled={submitting} errors={form?.errors ?? {}} />
		<TextField name="endDate" label="End date" type="date" value={data.trip.endDate ?? ''} disabled={submitting} errors={form?.errors ?? {}} />
		<div class="field sm:col-span-2">
			<label class="label" for="status">Status</label>
			<select id="status" name="status" value={data.trip.status} class="input {form?.errors?.status ? 'input-error' : ''}" disabled={submitting}>
				{#each TRIP_STATUSES as status}
					<option value={status}>{statusLabel[status]}</option>
				{/each}
			</select>
			{#if form?.errors?.status}<p class="field-error">{form.errors.status}</p>{/if}
		</div>
		<TextAreaField name="notes" label="Notes" rows={4} placeholder="Anything worth remembering…" disabled={submitting} class="sm:col-span-2" errors={form?.errors ?? {}}>{data.trip.notes ?? ''}</TextAreaField>
		<TextField name="tags" label="Tags" value={tagString(data.trip.tags)} placeholder="work, summer, family" disabled={submitting} class="sm:col-span-2" errors={form?.errors ?? {}} />
		<TextField name="baseCurrency" label="Base currency" value={data.trip.baseCurrency ?? 'USD'} placeholder="USD" maxlength="3" disabled={submitting} errors={form?.errors ?? {}} />
		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto(`/trips/${data.trip.id}`)}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>Save changes</button>
		</div>
	</form>
</section>

{#if data.owner === true}
	<section class="card mt-6 border-l-4 border-red-500 p-5 sm:p-6">
		<h2 class="section-title">Danger zone</h2>
		<p class="page-subtitle">Deleting this trip cannot be undone.</p>
		<form method="POST" action="?/delete" class="mt-4">
			<ConfirmButton class="btn btn-danger" message="Delete this trip and all its segments? This cannot be undone.">Delete trip</ConfirmButton>
		</form>
	</section>
{/if}
