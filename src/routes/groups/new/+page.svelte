<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form?: { error?: string; errors?: Record<string, string>; values?: Record<string, unknown> } } = $props();

	let submitting = $state(false);
	let isDirty = $state(false);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Create group</h1>
		<p class="page-subtitle">Start a group to share trips with others.</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form
		method="POST"
		action="?/create"
		class="grid gap-4"
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
		{#if form?.error}<p class="notice notice-error">{form.error}</p>{/if}

		<TextField
			name="name"
			label="Group name"
			value={(form?.values?.name as string | undefined) ?? ''}
			placeholder="Family, Coworkers…"
			required
			disabled={submitting}
			errors={form?.errors ?? {}}
		/>

		<div class="flex flex-wrap justify-end gap-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/groups')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>Create group</button>
		</div>
	</form>
</section>
