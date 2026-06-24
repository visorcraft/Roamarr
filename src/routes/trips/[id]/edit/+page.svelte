<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';

	let { data } = $props();
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div class="min-w-0">
		<h1 class="truncate text-3xl font-extrabold text-white">Edit trip</h1>
		<p class="mt-1 text-sm text-muted">Update the details for {data.trip.name}.</p>
	</div>
	<a href={`/trips/${data.trip.id}`} class="btn btn-ghost btn-sm">Cancel</a>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form method="POST" class="grid gap-4 sm:grid-cols-2">
		<div class="field sm:col-span-2">
			<label class="label" for="name">Trip name</label>
			<input id="name" name="name" value={data.trip.name} class="input" required />
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="destination">Destination</label>
			<input id="destination" name="destination" value={data.trip.destination ?? ''} placeholder="Lisbon, Portugal" class="input" />
		</div>
		<div class="field">
			<label class="label" for="startDate">Start date</label>
			<input id="startDate" name="startDate" type="date" value={data.trip.startDate ?? ''} class="input" />
		</div>
		<div class="field">
			<label class="label" for="endDate">End date</label>
			<input id="endDate" name="endDate" type="date" value={data.trip.endDate ?? ''} class="input" />
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="notes">Notes</label>
			<textarea id="notes" name="notes" rows="4" placeholder="Anything worth remembering…" class="textarea">{data.trip.notes ?? ''}</textarea>
		</div>
		<div class="sm:col-span-2">
			<button class="btn btn-primary">Save changes</button>
		</div>
	</form>
</section>

{#if data.owner === true}
	<section class="card mt-6 border-l-4 border-red-500 p-5 sm:p-6">
		<h2 class="section-title">Danger zone</h2>
		<p class="mt-1 text-sm text-muted">Deleting this trip cannot be undone.</p>
		<form method="POST" action="?/delete" class="mt-4">
			<ConfirmButton class="btn btn-danger" message="Delete this trip and all its segments? This cannot be undone.">Delete trip</ConfirmButton>
		</form>
	</section>
{/if}
