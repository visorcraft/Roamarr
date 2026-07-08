<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
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
		<h1 class="page-title">Add loyalty program</h1>
		<p class="page-subtitle">Track a frequent-flyer or rewards program and its current balance.</p>
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
			name="programName"
			label="Program name"
			value={form?.values?.programName ?? ''}
			placeholder="e.g. United MileagePlus"
			required
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextField
			name="membershipNumber"
			label="Membership number"
			value={form?.values?.membershipNumber ?? ''}
			placeholder="Membership number"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextField
			name="balance"
			label="Balance"
			type="number"
			value={form?.values?.balance ?? ''}
			placeholder="0"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextAreaField
			name="notes"
			label="Notes"
			value={form?.values?.notes ?? ''}
			placeholder="Optional notes"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/profile/loyalty')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>
				Add program
			</button>
		</div>
	</form>
</section>
