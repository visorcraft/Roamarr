<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { startAuthentication } from '@simplewebauthn/browser';
	import TextField from '$lib/components/TextField.svelte';
	import { m } from '$lib/paraglide/messages';

	let { data, form } = $props();
	let submitting = $state(false);
	let passkeyBusy = $state(false);
	let passkeyError = $state('');

	// Preserve the post-login target through the SSO round-trip, with the same
	// same-origin rule as the password form's `next` handling.
	const ssoHref = $derived.by(() => {
		const next = page.url.searchParams.get('next');
		return next && next.startsWith('/') && !next.startsWith('//')
			? `/auth/oidc/start?next=${encodeURIComponent(next)}`
			: '/auth/oidc/start';
	});

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
				const next = new URLSearchParams(window.location.search).get('next');
				window.location.href = next?.startsWith('/') && !next.startsWith('//') ? next : '/';
			} else {
				const body = await res.json().catch(() => ({}));
				passkeyError = body.message || m.login_passkey_failed();
			}
		} catch (e) {
			// Swallow user-cancelled prompts; surface real failures.
			passkeyError = e instanceof Error && e.name === 'NotAllowedError' ? '' : m.login_passkey_failed();
		} finally {
			passkeyBusy = false;
		}
	}
</script>

<div class="card w-full max-w-md p-7 sm:p-8">
	<h1 class="auth-title">{m.login_title()}</h1>
	<p class="page-subtitle">{m.login_subtitle()}</p>

	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

	<form method="POST" class="mt-6 grid gap-4" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }} aria-busy={submitting}>
		<TextField name="email" label={m.login_email_label()} type="email" autocomplete="email" placeholder="you@example.com" required disabled={submitting} />
		<TextField name="password" label={m.login_password_label()} type="password" autocomplete="current-password" placeholder="••••••••" required disabled={submitting} />
		<div class="flex items-center justify-between">
			<a href="/forgot-password" class="text-sm link">{m.login_forgot_password()}</a>
			<button type="submit" class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>{m.login_submit()}</button>
		</div>
	</form>

	{#if passkeyError}<p class="notice notice-error mt-3">{passkeyError}</p>{/if}

	{#if data.passkeyAvailable}
		<div class="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
			<button class="btn btn-primary w-full" onclick={signInWithPasskey} disabled={passkeyBusy}>
				{passkeyBusy ? m.login_passkey_waiting() : m.login_passkey_button()}
			</button>
		</div>
	{/if}

	{#if data.oidc?.enabled}
		<div class="mt-4 {data.passkeyAvailable ? '' : 'border-t border-slate-200 pt-4 dark:border-slate-700'}">
			<a href={ssoHref} class="btn btn-primary w-full text-center">{m.login_sso_button({ provider: data.oidc.displayName })}</a>
		</div>
	{/if}

	{#if data.allowRegistration}
		<p class="mt-5 text-center text-sm text-muted">
			{m.login_need_account()} <a href="/register" class="link">{m.login_create_account()}</a>
		</p>
	{/if}
</div>
