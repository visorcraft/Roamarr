<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';

	let { data, form } = $props();
	const tfa = $derived(data.state);
	const showSetup = $derived(Boolean(data.setup));
	const backupCodes = $derived(form?.backupCodes as string[] | undefined);

	let setupToken = $state('');
	let disablePassword = $state('');
	let regenToken = $state('');
	let savedAck = $state(false);

	$effect(() => {
		if (backupCodes) {
			savedAck = false;
		}
	});
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
		<div class="flex items-center gap-2 text-sm text-brand">
			<span class="inline-block h-2 w-2 rounded-full bg-brand"></span>
			Enabled{#if tfa.enabledAt}since {new Date(tfa.enabledAt).toLocaleDateString()}{/if}
		</div>
		<p class="meta mt-1">{tfa.backupCodesRemaining} backup code{tfa.backupCodesRemaining === 1 ? '' : 's'} remaining.</p>

		{#if backupCodes}
			<div class="notice notice-warning mt-4 p-4">
				<p class="text-sm font-medium">Save these backup codes</p>
				<p class="field-help mt-1">Each can be used once if you lose access to your authenticator. They won't be shown again.</p>
				<div class="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
					{#each backupCodes as code (code)}<span class="rounded bg-surface2 px-2 py-1 text-center">{code}</span>{/each}
				</div>
				<label class="mt-4 flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={savedAck} class="checkbox" />
					I saved these backup codes
				</label>
				<a
					href="/profile/security"
					class="btn btn-primary mt-3 inline-block"
					class:opacity-50={!savedAck}
					class:pointer-events-none={!savedAck}
					aria-disabled={!savedAck}
				>
					Done
				</a>
			</div>
		{/if}

		<div class="mt-4 space-y-4">
			<details class="rounded-md border border-line">
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

			<details class="rounded-md border border-line">
				<summary class="cursor-pointer px-4 py-2 text-sm font-medium text-ink">Disable 2FA</summary>
				<form method="POST" action="?/disable" class="space-y-3 p-4">
					<p class="field-help">Requires your account password and a valid TOTP code or backup code.</p>
					<div class="field">
						<label class="label" for="disablePass">Password</label>
						<input id="disablePass" name="password" type="password" bind:value={disablePassword} class="input" required />
					</div>
					<div class="field">
						<label class="label" for="disableTotp">TOTP code or backup code</label>
						<input id="disableTotp" name="totpCode" type="text" class="input" placeholder="123456 or abcd-ef12" autocomplete="one-time-code" required />
					</div>
					<ConfirmButton class="btn btn-ghost btn-ghost-danger" message="Disable two-factor authentication?">Disable 2FA</ConfirmButton>
				</form>
			</details>
		</div>
	{:else if showSetup}
		<div class="space-y-4">
			<p class="text-sm">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), or enter the secret manually.</p>
			<img src={data.setup!.qr} alt="QR code" class="mx-auto rounded-lg border border-line" />
			<div class="rounded-md bg-surface2 px-3 py-2 text-center font-mono text-sm">
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
