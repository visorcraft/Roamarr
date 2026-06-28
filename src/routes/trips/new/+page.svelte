<script lang="ts">
	import { enhance } from '$app/forms';
	import { COUNTRIES } from '$lib/countries';
	import CityAutocomplete from '$lib/components/segments/CityAutocomplete.svelte';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form?: { error?: string; errors?: Record<string, string> } } = $props();
	let submitting = $state(false);
	let selectedTemplateId = $state('');
	let destinationCountryCode = $state('');

	function applyTemplate() {
		const template = data.tripTemplates.find((t) => String(t.id) === selectedTemplateId);
		if (!template) return;
		try {
			const snapshot = JSON.parse(template.snapshotJson) as {
				name?: string;
				destinationCountryCode?: string | null;
				destinationCityName?: string | null;
				destinationCityLat?: number | null;
				destinationCityLng?: number | null;
				notes?: string | null;
				tags?: string[];
			};
			const nameInput = document.getElementById('name') as HTMLInputElement | null;
			const countryInput = document.getElementById('destinationCountryCode') as HTMLSelectElement | null;
			const cityInput = document.getElementById('destinationCityName') as HTMLInputElement | null;
			const cityLatInput = document.getElementById('destinationCityLat') as HTMLInputElement | null;
			const cityLngInput = document.getElementById('destinationCityLng') as HTMLInputElement | null;
			const notesInput = document.getElementById('notes') as HTMLTextAreaElement | null;
			const tagsInput = document.getElementById('tags') as HTMLInputElement | null;
			if (nameInput && !nameInput.value.trim()) nameInput.value = snapshot.name ?? '';
			if (countryInput && snapshot.destinationCountryCode) {
				countryInput.value = snapshot.destinationCountryCode;
				destinationCountryCode = snapshot.destinationCountryCode;
			}
			if (cityInput && snapshot.destinationCityName) {
				cityInput.value = snapshot.destinationCityName;
			}
			if (cityLatInput && snapshot.destinationCityLat != null) {
				cityLatInput.value = String(snapshot.destinationCityLat);
			}
			if (cityLngInput && snapshot.destinationCityLng != null) {
				cityLngInput.value = String(snapshot.destinationCityLng);
			}
			if (notesInput && !notesInput.value.trim()) notesInput.value = snapshot.notes ?? '';
			if (tagsInput && !tagsInput.value.trim()) tagsInput.value = (snapshot.tags ?? []).join(', ');
		} catch {
			// ignore
		}
	}
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

		{#if data.tripTemplates.length}
			<div class="field sm:col-span-2">
				<label class="label" for="templateId">Start from template</label>
				<select id="templateId" name="templateId" class="select" bind:value={selectedTemplateId} onchange={applyTemplate} disabled={submitting}>
					<option value="">None</option>
					{#each data.tripTemplates as tmpl (tmpl.id)}
						<option value={tmpl.id}>{tmpl.name}</option>
					{/each}
				</select>
			</div>
		{/if}
		<div class="field sm:col-span-2">
			<label class="label" for="name">Trip name</label>
			<input id="name" name="name" placeholder="Summer in Lisbon" class="input {form?.errors?.name ? 'input-error' : ''}" required disabled={submitting} />
			{#if form?.errors?.name}<p class="field-error">{form.errors.name}</p>{/if}
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
					<option value={c.code}>{c.name}</option>
				{/each}
			</select>
			{#if form?.errors?.destinationCountryCode}<p class="field-error">{form.errors.destinationCountryCode}</p>{/if}
		</div>
		<div class="field">
			<CityAutocomplete
				countryCode={destinationCountryCode}
				name="destinationCityName"
				value=""
				latName="destinationCityLat"
				lngName="destinationCityLng"
				errors={form?.errors ?? {}}
				disabled={submitting}
			/>
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
