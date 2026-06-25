<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordStrength from '$lib/components/PasswordStrength.svelte';

	let { data, form } = $props();
	let newPassword = $state('');
	let submitting = $state(false);
</script>

<header>
	<h1 class="page-title">Choose a new password</h1>
	<p class="page-subtitle">
		Your account must set a new password before you can continue. Signed in as {data.email}.
	</p>
</header>

{#if form?.error}
	<p class="notice notice-error mt-4">{form.error}</p>
{/if}

<section class="card mt-6 p-5 sm:p-6 sm:max-w-lg">
	<form method="POST" class="grid gap-4" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting}>
		<div class="field">
			<label class="label" for="newPassword">New password</label>
			<input id="newPassword" name="newPassword" type="password" autocomplete="new-password" class="input" required bind:value={newPassword} disabled={submitting} />
			<PasswordStrength password={newPassword} />
		</div>
		<div class="field">
			<label class="label" for="confirmPassword">Confirm new password</label>
			<input
				id="confirmPassword"
				name="confirmPassword"
				type="password"
				autocomplete="new-password"
				class="input"
				required
				disabled={submitting}
			/>
		</div>
		<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>Save password</button>
	</form>
</section>
