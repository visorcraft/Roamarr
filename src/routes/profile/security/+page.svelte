<script lang="ts">
	import { page } from '$app/state';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';

	let { data } = $props();
	const tfa = $derived(data.state);
	const showSetup = $derived(Boolean(data.setup));
	const showCodes = $derived(page.url.searchParams.get('codes') === '1');

	let setupToken = $state('');
	let disablePassword = $state('');
	let regenToken = $state('');
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Security</h1>
		<p class="page-subtitle">Manage two-factor authentication and account security.</p>
	</div>
</header>

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Two-factor authentication (2FA)</h2>

	{#if tfa.enabled}
		<div class="flex items-center gap-2 text-sm text-green-400">
			<span class="inline-block h-2 w-2 rounded-full bg-green-400"></span>
			Enabled{#if tfa.enabledAt}since {new Date(tfa.enabledAt).toLocaleDateString()}{/if}
		</div>
		<p class="meta mt-1">{tfa.backupCodesRemaining} backup code{tfa.backupCodesRemaining === 1 ? '' : 's'} remaining.</p>

		{#if showCodes}
			<div class="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
				<p class="text-sm font-medium text-amber-300">Save these backup codes</p>
				<p class="field-help mt-1 text-amber-200/70">Each can be used once if you lose access to your authenticator.</p>
			</div>
		{/if}

		<div class="mt-4 space-y-4">
			<details class="rounded-md border border-slate-200 dark:border-slate-700">
				<summary class="cursor-pointer px-4 py-2 text-sm font-medium">Regenerate backup codes</summary>
				<form method="POST" action="?/regenerate" class="space-y-3 p-4">
					<p class="field-help">Requires your current 6-digit code. Old codes are invalidated.</p>
					<div class="field">
						<label class="label" for="regenToken">Current code</label>
						<input id="regenToken" name="token" bind:value={regenToken} class="input" inputmode="numeric" placeholder="123456" />
					</div>
					<ConfirmButton class="btn btn-ghost btn-ghost-warning" message="Regenerate backup codes? Old codes will stop working.">Regenerate</ConfirmButton>
				</form>
			</details>

			<details class="rounded-md border border-red-500/30">
				<summary class="cursor-pointer px-4 py-2 text-sm font-medium text-red-400">Disable 2FA</summary>
				<form method="POST" action="?/disable" class="space-y-3 p-4">
					<p class="field-help">Requires your account password.</p>
					<div class="field">
						<label class="label" for="disablePass">Password</label>
						<input id="disablePass" name="password" type="password" bind:value={disablePassword} class="input" required />
					</div>
					<ConfirmButton class="btn btn-ghost btn-ghost-danger" message="Disable two-factor authentication?">Disable 2FA</ConfirmButton>
				</form>
			</details>
		</div>
	{:else if showSetup}
		<div class="space-y-4">
			<p class="text-sm">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), or enter the secret manually.</p>
			<img src={data.setup!.qr} alt="QR code" class="mx-auto rounded-lg border border-slate-200 dark:border-slate-700" />
			<div class="rounded-md bg-slate-100 px-3 py-2 text-center font-mono text-sm dark:bg-slate-800">
				{data.setup!.secret}
			</div>
			<form method="POST" action="?/enable" class="space-y-3">
				<input type="hidden" name="secret" value={data.setup!.secret} />
				<div class="field">
					<label class="label" for="setupToken">Enter the 6-digit code</label>
					<input id="setupToken" name="token" bind:value={setupToken} class="input text-center text-lg tracking-widest" inputmode="numeric" placeholder="123456" autocomplete="one-time-code" />
				</div>
				<button class="btn btn-primary">Enable 2FA</button>
			</form>
		</div>
	{:else}
		<p class="meta">Two-factor authentication is not enabled. Add an extra layer of security to your account.</p>
		<a href="/profile/security?setup=1" class="btn btn-primary mt-3 inline-block">Set up 2FA</a>
	{/if}
</section>

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Passkeys</h2>
	<p class="meta">Sign in passwordlessly with a passkey (Face ID, Touch ID, security key).</p>
	<a href="/profile/security/passkeys" class="btn btn-ghost mt-3 inline-block">Manage passkeys</a>
</section>

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">API connections</h2>
	<p class="meta">Connect AI assistants and integrations via OAuth 2.1.</p>
	<a href="/profile/security/connections" class="btn btn-ghost mt-3 inline-block">Manage connections</a>
</section>
