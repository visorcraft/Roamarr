<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import { formatDateTime } from '$lib/dateFormat';
	import type { PageData } from './$types';

	let { data, form }: {
		data: PageData;
		form?: { error?: string; errors?: Record<string, string>; values?: Record<string, unknown> };
	} = $props();

	let submitting = $state(false);
	let isDirty = $state(false);

	let program = $derived(data.program);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Edit loyalty program</h1>
		<p class="page-subtitle">{program.programName}</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
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

		<TextField
			name="programName"
			label="Program name"
			value={(form?.values?.programName as string | undefined) ?? program.programName}
			placeholder="e.g. United MileagePlus"
			required
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextField
			name="membershipNumber"
			label="Membership number"
			value={(form?.values?.membershipNumber as string | undefined) ?? program.membershipNumber ?? ''}
			placeholder="Membership number"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextField
			name="balance"
			label="Balance"
			type="number"
			value={(form?.values?.balance as string | number | undefined) ?? program.balance ?? ''}
			placeholder="0"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<div class="field">
			<label class="label" for="balanceUpdatedAt">Balance last updated</label>
			<input
				id="balanceUpdatedAt"
				class="input"
				value={program.balanceUpdatedAt ? formatDateTime(program.balanceUpdatedAt) : 'Never'}
				disabled
			/>
			<p class="mt-1 field-help">
				Saving with a changed balance stamps this timestamp. Use it to remember when you last checked.
			</p>
		</div>
		<TextAreaField
			name="notes"
			label="Notes"
			value={(form?.values?.notes as string | undefined) ?? program.notes ?? ''}
			placeholder="Optional notes"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/profile/loyalty')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>
				Save program
			</button>
		</div>
	</form>
</section>
