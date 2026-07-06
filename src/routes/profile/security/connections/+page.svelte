<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';

	let { data, form } = $props();
	let clientName = $state('');
	let redirectUris = $state('');
	let isPublic = $state(false);
	let selectedScopes = $state<string[]>(['trips:read', 'profile:read']);
	let dismissed = $state(false);
	// The create action returns the freshly-minted credentials once; surface them
	// (a confidential client's secret is never recoverable afterwards).
	const created = $derived(
		form && 'clientId' in form && !dismissed
			? { clientId: form.clientId as string, clientSecret: (form.clientSecret as string | null) ?? null }
			: null
	);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">API connections</h1>
		<p class="page-subtitle">Manage OAuth clients for AI assistants and integrations.</p>
	</div>
	<a href="/profile/security" class="btn btn-ghost ml-auto">Back to security</a>
</header>

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
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Create a client</h2>
		<form method="POST" action="?/create" class="space-y-4">
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
			<button class="btn btn-primary">Create client</button>
		</form>
	</section>
{/if}

{#if data.clients.length}
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Your clients</h2>
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
					<form method="POST" action="?/delete">
						<input type="hidden" name="clientId" value={c.clientId} />
						<ConfirmButton class="btn btn-danger btn-sm" message="Delete this client and revoke all its tokens?">Delete</ConfirmButton>
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if data.tokens.length}
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Active tokens</h2>
		<ul class="list-stack">
			{#each data.tokens.filter((t) => !t.revoked) as t (t.id)}
				<li class="list-item flex items-start gap-3">
					<div class="min-w-0 flex-1">
						<div class="list-title font-mono text-sm">{t.clientId}</div>
						<div class="meta mt-0.5">Scopes: {t.scopes.join(', ')}</div>
						<div class="meta mt-0.5">
							Created {new Date(t.createdAt).toLocaleDateString()}
							{#if t.lastUsedAt}· Last used {new Date(t.lastUsedAt).toLocaleDateString()}{/if}
						</div>
					</div>
					<form method="POST" action="?/revoke">
						<input type="hidden" name="tokenId" value={t.id} />
						<ConfirmButton class="btn btn-danger btn-sm" message="Revoke this token?">Revoke</ConfirmButton>
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Setup instructions</h2>
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
