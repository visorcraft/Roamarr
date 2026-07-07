<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form?: { error?: string; errors?: Record<string, string>; values?: Record<string, unknown> } } = $props();

	let updateSubmitting = $state(false);
	let addSubmitting = $state(false);
	let updateDirty = $state(false);

	const addError = $derived(form?.error && form.values && 'email' in form.values ? form.error : null);
	const updateError = $derived(form?.error && (!form.values || (!('email' in form.values) && !('removeMemberError' in form.values))) ? form.error : null);
	const removeMemberError = $derived(form?.error && form.values && 'removeMemberError' in form.values ? form.error : null);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Edit group</h1>
		<p class="page-subtitle">{data.group.name}</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form
		method="POST"
		action="?/update"
		class="grid gap-4"
		use:enhance={() => {
			updateSubmitting = true;
			return async ({ update }) => {
				await update();
				updateSubmitting = false;
			};
		}}
		aria-busy={updateSubmitting}
		oninput={() => (updateDirty = true)}
	>
		{#if updateError}<p class="notice notice-error">{updateError}</p>{/if}

		<TextField
			name="name"
			label="Group name"
			value={(form?.values?.name as string | undefined) ?? data.group.name}
			placeholder="Family, Coworkers…"
			required
			disabled={updateSubmitting}
			errors={form?.errors ?? {}}
		/>

		<div class="flex flex-wrap justify-end gap-2">
			<CancelButton dirty={updateDirty} onConfirm={() => goto('/groups')}>Cancel</CancelButton>
			<button class="btn btn-primary" disabled={updateSubmitting} class:btn-loading={updateSubmitting}>Save group</button>
		</div>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title mb-4">Members</h2>

	{#if removeMemberError}<p class="notice notice-error mb-4">{removeMemberError}</p>{/if}

	{#if data.members.length}
		<ul class="space-y-3">
			{#each data.members as m (m.id)}
				<li class="list-item-compact flex items-center justify-between gap-3">
					<div class="flex items-center gap-2">
						<Icon name="user" class="h-4 w-4 text-muted" />
						<span>{m.email}</span>
					</div>
					<form method="POST" action="?/removeMember" class="inline">
						<input type="hidden" name="userId" value={m.id} />
						<ConfirmButton class="btn btn-danger" message="Remove this member from the group?">Remove</ConfirmButton>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-muted">No members yet.</p>
	{/if}

	<form
		method="POST"
		action="?/addMember"
		class="mt-6 flex flex-wrap items-end gap-3"
		use:enhance={() => {
			addSubmitting = true;
			return async ({ update }) => {
				await update();
				addSubmitting = false;
			};
		}}
		aria-busy={addSubmitting}
	>
		{#if addError}<p class="notice notice-error w-full">{addError}</p>{/if}
		<TextField
			name="email"
			label="Add member"
			type="email"
			value={(form?.values?.email as string | undefined) ?? ''}
			placeholder="member@example.com"
			disabled={addSubmitting}
			errors={form?.errors ?? {}}
			class="min-w-0 flex-1"
		/>
		<button class="btn btn-primary" disabled={addSubmitting}>Add</button>
	</form>
</section>
