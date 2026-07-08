<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import Autocomplete from '$lib/components/Autocomplete.svelte';
	import type { AutocompleteSuggestion } from '$lib/components/Autocomplete.svelte';
	import type { PageData } from './$types';

	let { data, form }: {
		data: PageData;
		form?: { error?: string; errors?: Record<string, string>; values?: Record<string, unknown> };
	} = $props();

	let submitting = $state(false);
	let isDirty = $state(false);
	let reminderType = $state<'trip' | 'document'>('trip');

	// Re-pick toggle from a prior failed submit (form.values) without referencing
	// `form` inside $state initializer (Svelte 5 lints that as a stale read).
	$effect(() => {
		const fromForm = form?.values?.reminderType;
		if (fromForm === 'trip' || fromForm === 'document') {
			reminderType = fromForm;
		}
	});

	function switchType(next: 'trip' | 'document') {
		reminderType = next;
		isDirty = true;
	}

	async function fetchTrips(q: string): Promise<AutocompleteSuggestion[]> {
		const res = await fetch(`/api/trips/autocomplete?q=${encodeURIComponent(q)}`);
		if (!res.ok) return [];
		const body = (await res.json()) as { trips: AutocompleteSuggestion[] };
		return body.trips;
	}

	async function fetchDocuments(q: string): Promise<AutocompleteSuggestion[]> {
		const res = await fetch(`/api/travel-documents/autocomplete?q=${encodeURIComponent(q)}`);
		if (!res.ok) return [];
		const body = (await res.json()) as { documents: AutocompleteSuggestion[] };
		return body.documents;
	}
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Add reminder</h1>
		<p class="page-subtitle">Schedule an alert for a trip or an expiring document.</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form
		method="POST"
		action="?/create"
		class="grid gap-4 sm:grid-cols-2"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
		aria-busy={submitting}
		oninput={() => (isDirty = true)}
	>
		{#if form?.error}<p class="notice notice-error sm:col-span-2">{form.error}</p>{/if}

		<div class="sm:col-span-2">
			<h3 class="subsection-title">Type</h3>
			<div class="mt-2 flex gap-2">
				<button
					type="button"
					class="btn {reminderType === 'trip' ? 'btn-primary' : 'btn-ghost'}"
					onclick={() => switchType('trip')}
					disabled={submitting}
				>Trip reminder</button>
				<button
					type="button"
					class="btn {reminderType === 'document' ? 'btn-primary' : 'btn-ghost'}"
					onclick={() => switchType('document')}
					disabled={submitting}
				>Document reminder</button>
			</div>
			<input type="hidden" name="reminderType" value={reminderType} />
		</div>

		<div class="sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
			{#if reminderType === 'trip'}
				<Autocomplete
					name="refId"
					label="Trip (optional)"
					value=""
					valueId={null}
					placeholder="Search trips by name or destination"
					fetchSuggestions={fetchTrips}
					disabled={submitting}
					errors={form?.errors ?? {}}
				/>
			{:else}
				<Autocomplete
					name="refId"
					label="Document (optional)"
					value=""
					valueId={null}
					placeholder="Search documents by type"
					fetchSuggestions={fetchDocuments}
					disabled={submitting}
					errors={form?.errors ?? {}}
				/>
			{/if}
		</div>
		<TextField
			name="name"
			label="Name"
			value={form?.values?.name ?? ''}
			placeholder={reminderType === 'trip' ? 'e.g. Pack for Tokyo' : 'e.g. Renew passport'}
			required
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextField
			name="fireAt"
			label="When"
			type="datetime-local"
			value={form?.values?.fireAt ?? ''}
			required
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextAreaField
			name="description"
			label="Description"
			value={form?.values?.description ?? ''}
			placeholder="Optional notes"
			class="sm:col-span-2"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/profile/reminders')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>
				Add reminder
			</button>
		</div>
	</form>
</section>
