<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';

	let submitting = $state(false);
	let isDirty = $state(false);

	const networks = [
		{ key: 'visa', label: 'Visa' },
		{ key: 'mc', label: 'Mastercard' },
		{ key: 'amex', label: 'Amex' },
		{ key: 'disc', label: 'Discover' },
		{ key: 'other', label: 'Other' }
	];
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Add card</h1>
		<p class="page-subtitle">Save a payment card and track its travel benefits.</p>
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
		<TextField name="nickname" label="Nickname" placeholder="e.g. Sapphire Reserve" required disabled={submitting} />
		<SelectField name="network" label="Network" required disabled={submitting}>
			{#each networks as n (n.key)}
				<option value={n.key}>{n.label}</option>
			{/each}
		</SelectField>
		<TextField
			name="last4"
			label="Last 4"
			placeholder="1234"
			maxlength="4"
			inputmode="numeric"
			disabled={submitting}
		/>
		<TextField name="notes" label="Notes" placeholder="Optional notes" disabled={submitting} />
		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/cards')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>Add card</button>
		</div>
	</form>
</section>
