<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import TextField from '$lib/components/TextField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import CancelButton from '$lib/components/CancelButton.svelte';

	let { form } = $props();
	let submitting = $state(false);
	let isDirty = $state(false);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Create user</h1>
		<p class="page-subtitle">Add a new account and share the temporary password securely.</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	{#if form?.error}
		<div class="notice notice-error mb-4">
			{form.error}
		</div>
	{/if}

	{#if form?.success && form?.generatedPassword}
		<div class="notice notice-success mb-4">
			<p>Created account for <strong>{form.email}</strong>.</p>
			<p class="mt-1">
				Temporary password: <code class="code-chip">{form.generatedPassword}</code>
			</p>
			<p class="field-help mt-1">The user must change this password on first sign-in.</p>
		</div>
		<div class="flex justify-end">
			<a href="/users" class="btn btn-primary">Back to users</a>
		</div>
	{:else}
		<form
			method="POST"
			action="?/create"
			class="grid gap-4 sm:grid-cols-3"
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
			<TextField name="displayName" label="Display name" required disabled={submitting} />
			<TextField name="email" label="Email" type="email" required disabled={submitting} />
			<SelectField name="role" label="Role" required disabled={submitting}>
				<option value="user" selected>User</option>
				<option value="admin">Admin</option>
			</SelectField>
			<div class="flex flex-wrap justify-end gap-2 sm:col-span-3">
				<CancelButton dirty={isDirty} onConfirm={() => goto('/users')}>Cancel</CancelButton>
				<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>
					Create account
				</button>
			</div>
		</form>
	{/if}
</section>
