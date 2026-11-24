<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form?: { error?: string; errors?: Record<string, string>; values?: Record<string, unknown> } } = $props();

	let submitting = $state(false);
	let isDirty = $state(false);

	const networks = [
		{ key: 'visa', label: 'Visa' },
		{ key: 'mc', label: 'Mastercard' },
		{ key: 'amex', label: 'Amex' },
		{ key: 'disc', label: 'Discover' },
		{ key: 'other', label: m.common_other() }
	];
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">{m.page_title_card_new()}</h1>
		<p class="page-subtitle">{m.cards_new_subtitle()}</p>
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

		<TextField name="nickname" label={m.card_nickname_label()} value={form?.values?.nickname ?? ''} placeholder={m.card_nickname_placeholder()} required disabled={submitting} errors={form?.errors ?? {}} />
		<SelectField name="network" label={m.card_network_label()} value={form?.values?.network ?? ''} required disabled={submitting} errors={form?.errors ?? {}}>
			{#each networks as n (n.key)}
				<option value={n.key}>{n.label}</option>
			{/each}
		</SelectField>
		<TextField
			name="last4"
			label={m.card_last4_label()}
			value={form?.values?.last4 ?? ''}
			placeholder={m.card_last4_placeholder()}
			maxlength="4"
			inputmode="numeric"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<TextField name="notes" label={m.card_notes_label()} value={form?.values?.notes ?? ''} placeholder={m.card_notes_placeholder()} disabled={submitting} errors={form?.errors ?? {}} />
		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/cards')}>{m.common_cancel()}</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>{m.card_action_add()}</button>
		</div>
	</form>
</section>
