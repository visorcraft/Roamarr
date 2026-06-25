<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import { TRIP_STATUSES, type TripStatus } from '$lib/tripStatus';

	let { data, form }: { data: { trip: { id: number; name: string; destination: string | null; startDate: string | null; endDate: string | null; notes: string | null; tags: string; status: TripStatus }; owner: boolean }; form?: { error?: string; errors?: Record<string, string> } } = $props();
	let submitting = $state(false);

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
	<form method="POST" action="?/save" class="grid gap-4 sm:grid-cols-2" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting}>
		{#if form?.error}<p class="notice notice-error sm:col-span-2">{form.error}</p>{/if}

		<div class="field sm:col-span-2">
			<label class="label" for="name">Trip name</label>
			<input id="name" name="name" value={data.trip.name} class="input {form?.errors?.name ? 'input-error' : ''}" required disabled={submitting} />
			{#if form?.errors?.name}<p class="field-error">{form.errors.name}</p>{/if}
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="destination">Destination</label>
			<input id="destination" name="destination" value={data.trip.destination ?? ''} placeholder="Lisbon, Portugal" class="input {form?.errors?.destination ? 'input-error' : ''}" disabled={submitting} />
			{#if form?.errors?.destination}<p class="field-error">{form.errors.destination}</p>{/if}
		</div>
		<div class="field">
			<label class="label" for="startDate">Start date</label>
			<input id="startDate" name="startDate" type="date" value={data.trip.startDate ?? ''} class="input {form?.errors?.startDate ? 'input-error' : ''}" disabled={submitting} />
			{#if form?.errors?.startDate}<p class="field-error">{form.errors.startDate}</p>{/if}
		</div>
		<div class="field">
			<label class="label" for="endDate">End date</label>
			<input id="endDate" name="endDate" type="date" value={data.trip.endDate ?? ''} class="input {form?.errors?.endDate ? 'input-error' : ''}" disabled={submitting} />
			{#if form?.errors?.endDate}<p class="field-error">{form.errors.endDate}</p>{/if}
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="status">Status</label>
			<select id="status" name="status" value={data.trip.status} class="input {form?.errors?.status ? 'input-error' : ''}" disabled={submitting}>
				{#each TRIP_STATUSES as status}
					<option value={status}>{statusLabel[status]}</option>
				{/each}
			</select>
			{#if form?.errors?.status}<p class="field-error">{form.errors.status}</p>{/if}
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="notes">Notes</label>
			<textarea id="notes" name="notes" rows="4" placeholder="Anything worth remembering…" class="textarea {form?.errors?.notes ? 'input-error' : ''}" disabled={submitting}>{data.trip.notes ?? ''}</textarea>
			{#if form?.errors?.notes}<p class="field-error">{form.errors.notes}</p>{/if}
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="tags">Tags</label>
			<input id="tags" name="tags" value={tagString(data.trip.tags)} placeholder="work, summer, family" class="input {form?.errors?.tags ? 'input-error' : ''}" disabled={submitting} />
			{#if form?.errors?.tags}<p class="field-error">{form.errors.tags}</p>{/if}
		</div>
		<div class="flex flex-wrap gap-2 sm:col-span-2">
			<a href={`/trips/${data.trip.id}`} class="btn btn-ghost">Cancel</a>
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
