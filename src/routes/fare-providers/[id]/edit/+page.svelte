<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form?: { error?: string; errors?: Record<string, string> } } = $props();
	let submitting = $state(false);
	let isDirty = $state(false);

	const providerLabel = $derived(
		new Map(data.providers.map((p) => [p.key, p.label])).get(data.provider.providerKey) ??
			data.provider.providerKey
	);
</script>

<header>
	<div>
		<h1 class="page-title">Edit fare provider account</h1>
		<p class="page-subtitle">{providerLabel}</p>
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

		<input type="hidden" name="id" value={data.provider.id} />
		<TextField name="label" label="Label" value={data.provider.label} placeholder="e.g. Personal API key" disabled={submitting} errors={form?.errors ?? {}} />
		<div class="field flex items-end">
			<label class="checkbox-label">
				<input type="checkbox" name="enabled" checked={data.provider.enabled} class="checkbox" disabled={submitting} />
				Enabled
			</label>
		</div>
		<TextField
			name="apiKey"
			label="API key"
			placeholder={data.provider.hasKey ? 'API key set — leave blank to keep' : 'API key'}
			class="sm:col-span-2"
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>
		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/fare-providers')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>Save account</button>
		</div>
	</form>
</section>
