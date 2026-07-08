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

	const types = [
		{ key: 'passport', label: 'Passport' },
		{ key: 'drivers_license', label: "Driver's license" },
		{ key: 'global_entry', label: 'Global Entry' },
		{ key: 'visa', label: 'Visa' }
	];
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Add travel document</h1>
		<p class="page-subtitle">Record a passport, license, visa, or trusted-traveler card. Document numbers are encrypted at rest.</p>
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

		<SelectField
			name="type"
			label="Type"
			value={form?.values?.type ?? ''}
			required
			disabled={submitting}
			errors={form?.errors ?? {}}
		>
			{#each types as t (t.key)}
				<option value={t.key}>{t.label}</option>
			{/each}
		</SelectField>
		<TextField
			name="number"
			label="Document number"
			value={form?.values?.number ?? ''}
			placeholder="Document number"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextField
			name="issuingAuthority"
			label="Issuing authority"
			value={form?.values?.issuingAuthority ?? ''}
			placeholder="e.g. U.S. Department of State"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextField
			name="expiresOn"
			label="Expires on"
			type="date"
			value={form?.values?.expiresOn ?? ''}
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<SelectField
			name="companionId"
			label="Owner"
			value={form?.values?.companionId ?? ''}
			disabled={submitting}
			errors={form?.errors ?? {}}
		>
			<option value="">Me</option>
			{#each data.companions as c (c.id)}
				<option value={c.id}>{c.name} · {c.tripName}</option>
			{/each}
		</SelectField>
		<TextAreaField
			name="notes"
			label="Notes"
			value={form?.values?.notes ?? ''}
			placeholder="Optional notes"
			class="sm:col-span-2"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/profile/documents')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>
				Add document
			</button>
		</div>
	</form>
</section>
