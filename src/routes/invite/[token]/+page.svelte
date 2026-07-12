<script lang="ts">
	import { enhance } from '$app/forms';
	import PasswordStrength from '$lib/components/PasswordStrength.svelte';
	let { data, form } = $props();
	let password = $state('');
	let submitting = $state(false);
</script>

<div class="card w-full max-w-md p-7 sm:p-8">
	<h1 class="auth-title">Join this trip</h1>
	<p class="page-subtitle">Invitation for {data.email}</p>
	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}
	{#if data.signedIn}
		<form method="POST" class="mt-6"><button class="btn btn-primary w-full">Accept invitation</button></form>
	{:else if data.existingUser}
		<p class="mt-6 text-sm text-muted">Sign in with this email to accept the invitation.</p>
		<a href={data.loginHref} class="btn btn-primary mt-5 w-full">Sign in and accept</a>
	{:else}
		<form method="POST" class="mt-6 grid gap-4" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting}>
			<div class="field"><label class="label" for="displayName">Your name</label><input id="displayName" name="displayName" class="input" required disabled={submitting} /></div>
			<div class="field"><label class="label" for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password" class="input" required bind:value={password} disabled={submitting} /><PasswordStrength {password} /></div>
			<div class="field"><label class="label" for="confirmPassword">Confirm password</label><input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" class="input" required disabled={submitting} /></div>
			<button class="btn btn-primary w-full" disabled={submitting} class:btn-loading={submitting}>Create account and accept</button>
		</form>
	{/if}
</div>
