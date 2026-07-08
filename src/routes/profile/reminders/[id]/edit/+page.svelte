<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import Autocomplete from '$lib/components/Autocomplete.svelte';
	import type { AutocompleteSuggestion } from '$lib/components/Autocomplete.svelte';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';
	import { toDatetimeLocal } from '$lib/segments/datetimeLocal';
	import type { PageData } from './$types';

	const { formatDateTime } = useDateFormat();

	let { data, form }: {
		data: PageData;
		form?: { error?: string; errors?: Record<string, string>; values?: Record<string, unknown> };
	} = $props();

	let submitting = $state(false);
	let isDirty = $state(false);

	let reminder = $derived(data.reminder);
	let linkedName = $derived(data.linkedName);

	const reminderType = $derived(reminder.refType === 'document' ? 'document' : 'trip');
	const isSystem = $derived(reminder.kind !== 'custom');
	const isFired = $derived(reminder.status === 'sent');

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
		<h1 class="page-title">Edit reminder</h1>
		<p class="page-subtitle">
			{#if reminder.name}{reminder.name}{:else}(unnamed){/if}
			· {reminder.kind === 'flight_checkin' ? 'Flight check-in' : reminder.kind === 'document_expiry' ? 'Document expiry' : 'Custom'}
		</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	{#if isFired}
		<div class="notice notice-info mb-4">
			This reminder already fired on {formatDateTime(reminder.sentAt)}. Editing it
			<strong>will not</strong> make it fire again — only future-scheduled reminders fire.
			To fire again, delete this one and create a new reminder.
		</div>
	{/if}

	<form
		method="POST"
		action="?/update"
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

	<div class="sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
		{#if reminder.refType === 'document'}
			<Autocomplete
				name="refId"
				label="Document (optional)"
				value={linkedName ?? ''}
				valueId={reminder.refId || null}
				placeholder="Search documents by type"
				fetchSuggestions={fetchDocuments}
				disabled={submitting || isSystem}
				errors={form?.errors ?? {}}
			/>
		{:else}
			<Autocomplete
				name="refId"
				label="Trip (optional)"
				value={linkedName ?? ''}
				valueId={reminder.refId || null}
				placeholder="Search trips by name or destination"
				fetchSuggestions={fetchTrips}
				disabled={submitting || isSystem}
				errors={form?.errors ?? {}}
			/>
		{/if}
		{#if isSystem}
			<p class="mt-1 field-help">
				System-managed link (from a {reminderType}). Cannot be re-pointed.
			</p>
		{/if}
	</div>
	<div class="field">
		<label class="label" for="reminder-status">Status</label>
		<input
			id="reminder-status"
			class="input"
			value={`${reminder.status}${reminder.sentAt ? ` · ${formatDateTime(reminder.sentAt)}` : ''}`}
			disabled
		/>
		<p class="mt-1 field-help">
			Status is set by the scheduler. Edits never re-arm a fired reminder.
		</p>
	</div>

	<TextField
		name="name"
		label="Name"
		value={(form?.values?.name as string | undefined) ?? reminder.name ?? ''}
		placeholder="Reminder name"
		disabled={submitting}
		errors={form?.errors ?? {}}
	/>
	<TextField
		name="fireAt"
		label="When"
		type="datetime-local"
		value={(form?.values?.fireAt as string | undefined) ?? toDatetimeLocal(reminder.fireAt, data.timezone)}
		required
		disabled={submitting}
		errors={form?.errors ?? {}}
	/>
	<TextAreaField
		name="description"
		label="Description"
		value={(form?.values?.description as string | undefined) ?? reminder.description ?? ''}
		placeholder="Optional notes"
		class="sm:col-span-2"
		disabled={submitting}
		errors={form?.errors ?? {}}
	/>

		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/profile/reminders')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>
				Save reminder
			</button>
		</div>
	</form>
</section>
