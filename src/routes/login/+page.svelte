<script lang="ts">
	import { enhance } from '$app/forms';
	import { startAuthentication } from '@simplewebauthn/browser';
	import TextField from '$lib/components/TextField.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
	let passkeyBusy = $state(false);
	let passkeyError = $state('');

	async function signInWithPasskey() {
		passkeyError = '';
		if (!data.passkeyAvailable) return;
		try {
			passkeyBusy = true;
			const opts = await fetch('/api/webauthn/auth/options', { method: 'POST' }).then((r) => r.json());
			const credential = await startAuthentication({ optionsJSON: opts });
			const res = await fetch('/api/webauthn/auth/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(credential)
			});
			if (res.ok) {
				window.location.href = '/';
			} else {
				const body = await res.json().catch(() => ({}));
				passkeyError = body.message || 'Passkey sign-in failed';
			}
		} catch (e) {
			// Swallow user-cancelled prompts; surface real failures.
			passkeyError = e instanceof Error && e.name === 'NotAllowedError' ? '' : 'Passkey sign-in failed';
		} finally {
			passkeyBusy = false;
		}
	}
</script>

<div class="card w-full max-w-md p-7 sm:p-8">
	<h1 class="auth-title">Sign in</h1>
	<p class="page-subtitle">Welcome back to your travel HQ.</p>

	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

	<form method="POST" class="mt-6 grid gap-4" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting}>
		<TextField name="email" label="Email" type="email" autocomplete="email" placeholder="you@example.com" required disabled={submitting} />
		<TextField name="password" label="Password" type="password" autocomplete="current-password" placeholder="••••••••" required disabled={submitting} />
		<div class="flex items-center justify-between">
			<a href="/forgot-password" class="text-sm link">Forgot password?</a>
			<button class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>Sign in</button>
		</div>
	</form>

	{#if passkeyError}<p class="notice notice-error mt-3">{passkeyError}</p>{/if}

	{#if data.passkeyAvailable}
		<div class="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
			<button class="btn btn-ghost w-full" onclick={signInWithPasskey} disabled={passkeyBusy}>
				{passkeyBusy ? 'Waiting…' : 'Sign in with a passkey'}
			</button>
		</div>
	{/if}

	{#if data.allowRegistration}
		<p class="mt-5 text-center text-sm text-muted">
			Need an account? <a href="/register" class="link">Create one</a>
		</p>
	{/if}
</div>
