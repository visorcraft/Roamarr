<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import type { PageData } from './$types';

	let { data, form }: {
		data: PageData;
		form?: { error?: string; errors?: Record<string, string>; values?: Record<string, unknown> };
	} = $props();

	let submitting = $state(false);
	let isDirty = $state(false);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Add policy</h1>
		<p class="page-subtitle">Save a travel insurance policy and link it to a trip.</p>
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

		<TextField
			name="provider"
			label="Provider"
			value={form?.values?.provider ?? ''}
			placeholder="e.g. Allianz"
			required
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextField
			name="policyNumber"
			label="Policy number"
			value={form?.values?.policyNumber ?? ''}
			placeholder="Policy number"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextAreaField
			name="coverageSummary"
			label="Coverage summary"
			value={form?.values?.coverageSummary ?? ''}
			placeholder="What's covered"
			disabled={submitting}
			class="sm:col-span-2"
			errors={form?.errors ?? {}}
		/>
		<div class="grid gap-4 sm:grid-cols-2 sm:col-span-2">
			<TextField
				name="coverageAmount"
				label="Coverage amount (cents)"
				type="number"
				value={form?.values?.coverageAmount ?? ''}
				placeholder="0"
				disabled={submitting}
				errors={form?.errors ?? {}}
			/>
			<TextField
				name="currency"
				label="Currency"
				value={form?.values?.currency ?? 'USD'}
				placeholder="USD"
				disabled={submitting}
				errors={form?.errors ?? {}}
			/>
		</div>
		<SelectField
			name="tripId"
			label="Trip"
			value={form?.values?.tripId ?? ''}
			disabled={submitting}
			errors={form?.errors ?? {}}
		>
			<option value="">No trip</option>
			{#each data.trips as t (t.id)}
				<option value={t.id}>{t.name}</option>
			{/each}
		</SelectField>
		<div class="grid gap-4 sm:grid-cols-2">
			<TextField
				name="startDate"
				label="Start date"
				type="date"
				value={form?.values?.startDate ?? ''}
				disabled={submitting}
				errors={form?.errors ?? {}}
			/>
			<TextField
				name="endDate"
				label="End date"
				type="date"
				value={form?.values?.endDate ?? ''}
				disabled={submitting}
				errors={form?.errors ?? {}}
			/>
		</div>
		<TextField
			name="notes"
			label="Notes"
			value={form?.values?.notes ?? ''}
			placeholder="Optional notes"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/insurance')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>
				Add policy
			</button>
		</div>
	</form>
</section>
