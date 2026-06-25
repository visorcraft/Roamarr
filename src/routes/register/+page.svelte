<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordStrength from '$lib/components/PasswordStrength.svelte';

	let { form } = $props();
	let password = $state('');
	let submitting = $state(false);
</script>

<div class="card w-full max-w-md p-7 sm:p-8">
	<h1 class="auth-title">Create an account</h1>
	<p class="page-subtitle">Join your travel HQ.</p>

	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

	<form method="POST" class="mt-6 grid gap-4" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting}>
		<div class="field">
			<label class="label" for="displayName">Your name</label>
			<input id="displayName" name="displayName" placeholder="Ada Lovelace" class="input" required disabled={submitting} />
		</div>
		<div class="field">
			<label class="label" for="email">Email</label>
			<input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" class="input" required disabled={submitting} />
		</div>
		<div class="field">
			<label class="label" for="password">Password</label>
			<input id="password" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" class="input" required bind:value={password} disabled={submitting} />
			<PasswordStrength {password} />
		</div>
		<button class="btn btn-primary mt-1 w-full" disabled={submitting} class:btn-loading={submitting}>Sign up</button>
	</form>

	<p class="mt-5 text-center text-sm text-muted">
		Already have an account? <a href="/login" class="link">Sign in</a>
	</p>
</div>
