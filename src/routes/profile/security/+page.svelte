<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import SecurityTabs from '$lib/components/SecurityTabs.svelte';
	import { startRegistration as webauthnRegister } from '@simplewebauthn/browser';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';

	const { formatDate } = useDateFormat();

	let { data, form } = $props();

	const activeTab = $derived(page.url.searchParams.get('tab') ?? 'password');
	const tfa = $derived(data.state);
	const backupCodes = $derived(form?.backupCodes as string[] | undefined);

	let submittingProfile = $state(false);
	let disablePassword = $state('');
	let regenToken = $state('');
	let savedAck = $state(false);

	$effect(() => {
		if (backupCodes) {
			savedAck = false;
		}
	});

	let registering = $state(false);
	let newName = $state('');
	let regError = $state('');

	async function startRegistration() {
		regError = '';
		if (!data.available) {
			regError = 'ORIGIN must be configured to use passkeys.';
			return;
		}
		try {
			registering = true;
			const opts = await fetch('/api/webauthn/register/options', { method: 'POST' }).then((r) => r.json());
			const credential = await webauthnRegister({ optionsJSON: opts });
			const name = newName.trim() || 'Passkey';
			const res = await fetch('/api/webauthn/register/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ response: credential, name })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				regError = body.message || 'Registration failed';
			} else {
				registering = false;
				newName = '';
				window.location.reload();
			}
		} catch (e) {
			regError = e instanceof Error ? e.message : 'Registration failed';
		} finally {
			registering = false;
		}
	}

	let editingId = $state<number | null>(null);

	let clientName = $state('');
	let redirectUris = $state('');
	let isPublic = $state(false);
	let selectedScopes = $state<string[]>(['trips:read', 'profile:read']);
	let dismissed = $state(false);
	const created = $derived(
		form && 'clientId' in form && !dismissed
			? { clientId: form.clientId as string, clientSecret: (form.clientSecret as string | null) ?? null }
			: null
	);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Security</h1>
		<p class="page-subtitle">Manage your password, two-factor authentication, passkeys, and API connections.</p>
	</div>
</header>

<SecurityTabs />

{#if form?.error}<p class="notice notice-error mt-6">{form.error}</p>{/if}

{#if activeTab === 'password'}
	<section class="card mt-6 p-5 sm:p-6">
		<h2 class="section-title mb-4">Change password</h2>
		<form
			method="POST"
			action="?/updatePassword"
			use:enhance={() => {
				submittingProfile = true;
				return async ({ update }) => {
					await update();
					submittingProfile = false;
				};
			}}
			class="grid gap-4 sm:grid-cols-2"
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
			<div class="flex justify-end sm:col-span-2">
				<button class="btn btn-primary" class:btn-loading={submittingProfile} disabled={submittingProfile}>
					Update password
				</button>
			</div>
		</form>
	</section>
{:else if activeTab === '2fa'}
	<section class="card mt-6 p-5 sm:p-6">
		<h2 class="section-title mb-4">Two-factor authentication</h2>

		{#if tfa.enabled}
			<div class="flex items-center gap-2 text-sm text-brand">
				<span class="inline-block h-2 w-2 rounded-full bg-brand"></span>
				Enabled{#if tfa.enabledAt} since {formatDate(tfa.enabledAt)}{/if}
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
						href="/profile/security?tab=2fa"
						class="btn btn-primary mt-3 inline-block"
						class:opacity-50={!savedAck}
						class:pointer-events-none={!savedAck}
						aria-disabled={!savedAck}
					>
						Done
					</a>
				</div>
			{/if}

			<div class="mt-6 space-y-4">
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
						<ConfirmButton class="btn btn-danger" message="Disable two-factor authentication?">Disable 2FA</ConfirmButton>
					</form>
				</details>
			</div>
		{:else}
			{#if backupCodes}
				<div class="notice notice-warning p-4">
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
						href="/profile/security?tab=2fa"
						class="btn btn-primary mt-3 inline-block"
						class:opacity-50={!savedAck}
						class:pointer-events-none={!savedAck}
						aria-disabled={!savedAck}
					>
						Done
					</a>
				</div>
			{:else}
				<form method="POST" action="?/enable" class="space-y-4">
					<p class="text-sm">
						Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), or enter the secret manually.
					</p>
					<img src={data.setup.qr} alt="QR code" class="mx-auto rounded-lg border border-line" />
					<div class="rounded-md bg-surface2 px-3 py-2 text-center font-mono text-sm">
						{data.setup.secret}
					</div>
					<input type="hidden" name="secret" value={data.setup.secret} />
					<div class="field">
						<label class="label" for="setupToken">Enter the 6-digit code</label>
						<input
							id="setupToken"
							name="token"
							class="input text-center text-lg tracking-widest"
							inputmode="numeric"
							placeholder="123456"
							autocomplete="one-time-code"
							required
						/>
					</div>
					<div class="flex justify-end">
						<button class="btn btn-primary">Enable 2FA</button>
					</div>
				</form>
			{/if}
		{/if}
	</section>
{:else if activeTab === 'passkeys'}
	<section class="card mt-6 p-5 sm:p-6">
		<h2 class="section-title mb-4">Register a new passkey</h2>
		{#if !data.available}
			<p class="text-sm text-amber-400">Passkeys require the ORIGIN environment variable to be set.</p>
		{:else}
			<div class="space-y-4">
				<div class="field">
					<label class="label" for="passkeyName">Name (optional)</label>
					<input id="passkeyName" bind:value={newName} placeholder="e.g. iPhone, YubiKey" class="input" />
				</div>
				<div class="flex justify-end">
					<button class="btn btn-primary" onclick={startRegistration} disabled={registering}>
						{registering ? 'Waiting…' : 'Add passkey'}
					</button>
				</div>
			</div>
			{#if regError}
				<p class="notice notice-error mt-2 text-sm">{regError}</p>
			{/if}
		{/if}
	</section>

	{#if data.passkeys.length}
		<section class="card mt-6 p-5 sm:p-6">
			<h2 class="section-title mb-4">Your passkeys</h2>
			<ul class="list-stack">
				{#each data.passkeys as pk (pk.id)}
					<li class="list-item flex items-center gap-3">
						<div class="min-w-0 flex-1">
							{#if editingId === pk.id}
								<form method="POST" action="?/renamePasskey" class="flex items-center justify-end gap-2">
									<input type="hidden" name="id" value={pk.id} />
									<input name="name" value={pk.name ?? ''} class="input min-w-0 flex-1" placeholder="Name" />
									<button class="btn btn-primary btn-sm">Save</button>
								</form>
							{:else}
								<div class="list-title">{pk.name ?? 'Unnamed passkey'}</div>
								<div class="meta mt-0.5">
									{pk.deviceType ?? 'Unknown device'}
									{#if pk.lastUsedAt}· Last used {formatDate(pk.lastUsedAt)}{/if}
								</div>
							{/if}
						</div>
						{#if editingId !== pk.id}
							<div class="flex gap-1">
								<button type="button" class="btn btn-primary btn-sm" onclick={() => { editingId = pk.id; }}>Rename</button>
								<form method="POST" action="?/deletePasskey">
									<input type="hidden" name="id" value={pk.id} />
									<ConfirmButton class="btn btn-danger btn-sm" message="Delete this passkey?">Delete</ConfirmButton>
								</form>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{:else if activeTab === 'api-clients'}
	{#if created}
		<section class="notice notice-warning mt-6 p-5">
			<h2 class="section-title mb-2">Save your credentials</h2>
			<p class="field-help">Copy these now — the client secret won't be shown again.</p>
			<dl class="mt-3 space-y-2">
				<div>
					<dt class="label">Client ID</dt>
					<dd class="mt-0.5 break-all rounded-md bg-surface2 px-3 py-1.5 font-mono text-sm">{created.clientId}</dd>
				</div>
				<div>
					<dt class="label">Client Secret</dt>
					{#if created.clientSecret}
						<dd class="mt-0.5 break-all rounded-md bg-surface2 px-3 py-1.5 font-mono text-sm">{created.clientSecret}</dd>
					{:else}
						<dd class="mt-0.5 text-sm text-muted">Public client — authenticates with PKCE, no secret.</dd>
					{/if}
				</div>
			</dl>
			<button class="btn btn-primary mt-3" onclick={() => (dismissed = true)}>I saved them</button>
		</section>
	{:else}
		<section class="card mt-6 p-5 sm:p-6">
			<h2 class="section-title mb-4">Create a client</h2>
			<form method="POST" action="?/createClient" class="space-y-4">
				<div class="field">
					<label class="label" for="clientName">Client name</label>
					<input id="clientName" name="clientName" bind:value={clientName} placeholder="e.g. Claude Desktop" class="input" />
				</div>
				<div class="field">
					<label class="label" for="redirectUris">Redirect URIs (one per line)</label>
					<textarea id="redirectUris" name="redirectUris" bind:value={redirectUris} rows="3" placeholder="http://localhost:3000/callback" class="input"></textarea>
				</div>
				<div class="field">
					<span class="label">Scopes</span>
					<div class="mt-2 grid gap-2 sm:grid-cols-2">
						{#each data.allScopes as scope (scope)}
							<label class="checkbox-label text-sm">
								<input
									type="checkbox"
									name="scopes"
									value={scope}
									class="checkbox"
									checked={selectedScopes.includes(scope)}
									onchange={(e) => {
										if (e.currentTarget.checked) selectedScopes = [...selectedScopes, scope];
										else selectedScopes = selectedScopes.filter((s) => s !== scope);
									}}
								/>
								<span class="font-medium">{scope}</span>
								<span class="text-muted"> — {data.scopeDescriptions[scope]}</span>
							</label>
						{/each}
					</div>
				</div>
				<label class="checkbox-label text-sm">
					<input type="checkbox" name="isPublic" class="checkbox" bind:checked={isPublic} />
					<span class="font-medium">Public client</span>
					<span class="text-muted"> — uses PKCE only, no secret (for apps that can't store one)</span>
				</label>
				<div class="flex justify-end">
					<button class="btn btn-primary">Create client</button>
				</div>
			</form>
		</section>
	{/if}

	{#if data.clients.length}
		<section class="card mt-6 p-5 sm:p-6">
			<h2 class="section-title mb-4">Your clients</h2>
			<ul class="list-stack">
				{#each data.clients as c (c.clientId)}
					<li class="list-item flex items-start gap-3">
						<div class="min-w-0 flex-1">
							<div class="list-title">{c.clientName}</div>
							<div class="meta mt-0.5 font-mono text-xs">{c.clientId}</div>
							<div class="meta mt-0.5">
								Scopes: {c.scopes.join(', ') || 'none'}
							</div>
						</div>
						<form method="POST" action="?/deleteClient">
							<input type="hidden" name="clientId" value={c.clientId} />
							<ConfirmButton class="btn btn-danger btn-sm" message="Delete this client and revoke all its tokens?">Delete</ConfirmButton>
						</form>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.tokens.length}
		<section class="card mt-6 p-5 sm:p-6">
			<h2 class="section-title mb-4">Active tokens</h2>
			<ul class="list-stack">
				{#each data.tokens.filter((t) => !t.revoked) as t (t.id)}
					<li class="list-item flex items-start gap-3">
						<div class="min-w-0 flex-1">
							<div class="list-title font-mono text-sm">{t.clientId}</div>
							<div class="meta mt-0.5">Scopes: {t.scopes.join(', ')}</div>
							<div class="meta mt-0.5">
								Created {formatDate(t.createdAt)}
								{#if t.lastUsedAt}· Last used {formatDate(t.lastUsedAt)}{/if}
							</div>
						</div>
						<form method="POST" action="?/revokeToken">
							<input type="hidden" name="tokenId" value={t.id} />
							<ConfirmButton class="btn btn-danger btn-sm" message="Revoke this token?">Revoke</ConfirmButton>
						</form>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="card mt-6 p-5 sm:p-6">
		<h2 class="section-title mb-4">Setup instructions</h2>
		<p class="text-sm text-muted">
			Use the discovery URL below to configure an MCP client such as Claude Desktop. The client
			must support OAuth 2.1 with PKCE.
		</p>
		<div class="mt-3">
			<dt class="label">Discovery URL</dt>
			<dd class="mt-0.5 break-all rounded-md bg-surface2 px-3 py-1.5 font-mono text-sm">{data.discoveryUrl}</dd>
		</div>
		<div class="mt-4 space-y-1 text-sm text-muted">
			<p>1. Create a client above and save the client ID (and secret for confidential clients).</p>
			<p>2. Use this redirect URI in your client: <code>http://localhost:3000/oauth/callback</code> (or another localhost port).</p>
			<p>3. Authorize the client when prompted; access tokens are valid for one hour.</p>
		</div>
	</section>
{/if}
