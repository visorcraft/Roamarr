<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import CancelButton from '$lib/components/CancelButton.svelte';

	let { form } = $props();
	let submitting = $state(false);
	let isDirty = $state(false);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Change password</h1>
		<p class="page-subtitle">Update the password used to sign in.</p>
	</div>
</header>

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

<section class="card mt-6 p-5 sm:p-6">
	<form
		method="POST"
		action="?/updatePassword"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
		class="grid gap-4 sm:grid-cols-2"
		oninput={() => (isDirty = true)}
	>
		<div class="field">
			<label class="label" for="newPassword">New password</label>
			<input id="newPassword" name="newPassword" type="password" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="confirmPassword">Confirm new password</label>
			<input id="confirmPassword" name="confirmPassword" type="password" class="input" required />
		</div>
		<div class="field sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
			<label class="label" for="oldPassword">Current password</label>
			<input id="oldPassword" name="oldPassword" type="password" class="input" required />
		</div>
		<div class="flex flex-wrap justify-end gap-2 sm:col-span-2">
			<CancelButton dirty={isDirty} onConfirm={() => goto('/profile/security')}>Cancel</CancelButton>
			<button class="btn btn-primary" class:btn-loading={submitting} disabled={submitting}>
				Update password
			</button>
		</div>
	</form>
</section>
