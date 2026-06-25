<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let submitting = $state(false);
</script>

<div class="card w-full max-w-md p-7 sm:p-8">
	<h1 class="auth-title">Sign in</h1>
	<p class="page-subtitle">Welcome back to your travel HQ.</p>

	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

	<form method="POST" class="mt-6 grid gap-4" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting}>
		<div class="field">
			<label class="label" for="email">Email</label>
			<input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" class="input" required disabled={submitting} />
		</div>
		<div class="field">
			<label class="label" for="password">Password</label>
			<input id="password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" class="input" required disabled={submitting} />
		</div>
		<div class="flex items-center justify-between">
			<a href="/forgot-password" class="text-sm link">Forgot password?</a>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>Sign in</button>
		</div>
	</form>

	{#if data.allowRegistration}
		<p class="mt-5 text-center text-sm text-muted">
			Need an account? <a href="/register" class="link">Create one</a>
		</p>
	{/if}
</div>
