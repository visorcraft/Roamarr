<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { COUNTRIES } from '$lib/countries';
	import CityAutocomplete from '$lib/components/segments/CityAutocomplete.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form?: { error?: string; errors?: Record<string, string> } } = $props();
	let submitting = $state(false);
	let selectedTemplateId = $state('');
	let destinationCountryCode = $state('');
	let isDirty = $state(false);

	function applyTemplate() {
		const template = data.tripTemplates.find((t) => String(t.id) === selectedTemplateId);
		if (!template) return;
		try {
			const snapshot = template.snapshot as {
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
			isDirty = true;
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
	<form method="POST" class="grid gap-4 sm:grid-cols-2" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting} oninput={() => (isDirty = true)}>
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
		<TextField name="name" label="Trip name" placeholder="Summer in Lisbon" required disabled={submitting} class="sm:col-span-2" errors={form?.errors ?? {}} />
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
		<TextField name="startDate" label="Start date" type="date" disabled={submitting} errors={form?.errors ?? {}} />
		<TextField name="endDate" label="End date" type="date" disabled={submitting} errors={form?.errors ?? {}} />
		<div class="field sm:col-span-2">
			<label class="label" for="defaultVisibility">Default visibility</label>
			<select id="defaultVisibility" name="defaultVisibility" class="select {form?.errors?.defaultVisibility ? 'input-error' : ''}" disabled={submitting}>
				<option value="private">Private</option>
				<option value="groups">Groups</option>
				<option value="public">Public</option>
			</select>
			{#if form?.errors?.defaultVisibility}<p class="field-error">{form.errors.defaultVisibility}</p>{/if}
		</div>
		<TextAreaField name="notes" label="Notes" rows={4} placeholder="Anything worth remembering…" disabled={submitting} class="sm:col-span-2" errors={form?.errors ?? {}} />
		<TextField name="tags" label="Tags" placeholder="work, summer, family" disabled={submitting} class="sm:col-span-2" errors={form?.errors ?? {}} />
		<div class="flex flex-wrap gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/trips')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>Create trip</button>
		</div>
	</form>
</section>
