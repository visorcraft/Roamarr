<script lang="ts">
	import { enhance } from '$app/forms';

	let { form }: { form?: { error?: string; errors?: Record<string, string> } } = $props();
	let submitting = $state(false);
</script>

<header>
	<div>
		<h1 class="page-title">New trip</h1>
		<p class="page-subtitle">Plan a new journey and set who can see it.</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form method="POST" class="grid gap-4 sm:grid-cols-2" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting}>
		{#if form?.error}<p class="notice notice-error sm:col-span-2">{form.error}</p>{/if}

		<div class="field sm:col-span-2">
			<label class="label" for="name">Trip name</label>
			<input id="name" name="name" placeholder="Summer in Lisbon" class="input {form?.errors?.name ? 'input-error' : ''}" required disabled={submitting} />
			{#if form?.errors?.name}<p class="field-error">{form.errors.name}</p>{/if}
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="destination">Destination</label>
			<input id="destination" name="destination" placeholder="Lisbon, Portugal" class="input {form?.errors?.destination ? 'input-error' : ''}" disabled={submitting} />
			{#if form?.errors?.destination}<p class="field-error">{form.errors.destination}</p>{/if}
		</div>
		<div class="field">
			<label class="label" for="startDate">Start date</label>
			<input id="startDate" name="startDate" type="date" class="input {form?.errors?.startDate ? 'input-error' : ''}" disabled={submitting} />
			{#if form?.errors?.startDate}<p class="field-error">{form.errors.startDate}</p>{/if}
		</div>
		<div class="field">
			<label class="label" for="endDate">End date</label>
			<input id="endDate" name="endDate" type="date" class="input {form?.errors?.endDate ? 'input-error' : ''}" disabled={submitting} />
			{#if form?.errors?.endDate}<p class="field-error">{form.errors.endDate}</p>{/if}
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="defaultVisibility">Default visibility</label>
			<select id="defaultVisibility" name="defaultVisibility" class="select {form?.errors?.defaultVisibility ? 'input-error' : ''}" disabled={submitting}>
				<option value="private">Private</option>
				<option value="groups">Groups</option>
				<option value="public">Public</option>
			</select>
			{#if form?.errors?.defaultVisibility}<p class="field-error">{form.errors.defaultVisibility}</p>{/if}
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="notes">Notes</label>
			<textarea id="notes" name="notes" rows="4" placeholder="Anything worth remembering…" class="textarea {form?.errors?.notes ? 'input-error' : ''}" disabled={submitting}></textarea>
			{#if form?.errors?.notes}<p class="field-error">{form.errors.notes}</p>{/if}
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="tags">Tags</label>
			<input id="tags" name="tags" placeholder="work, summer, family" class="input {form?.errors?.tags ? 'input-error' : ''}" disabled={submitting} />
			{#if form?.errors?.tags}<p class="field-error">{form.errors.tags}</p>{/if}
		</div>
		<div class="flex flex-wrap gap-2 sm:col-span-2">
			<a href="/trips" class="btn btn-ghost">Cancel</a>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>Create trip</button>
		</div>
	</form>
</section>
