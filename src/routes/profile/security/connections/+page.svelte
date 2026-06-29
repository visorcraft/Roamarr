<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';

	let { data } = $props();
	let clientName = $state('');
	let redirectUris = $state('');
	let selectedScopes = $state<string[]>(['trips:read', 'profile:read']);
	let createdSecret = $state<{ clientId: string; clientSecret: string } | null>(null);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">API connections</h1>
		<p class="page-subtitle">Manage OAuth clients for AI assistants and integrations.</p>
	</div>
	<a href="/profile/security" class="btn btn-ghost ml-auto">Back to security</a>
</header>

{#if createdSecret}
	<section class="card mt-6 border border-amber-500/40 p-5">
		<h2 class="section-title mb-2 text-amber-300">Save your credentials</h2>
		<p class="field-help text-amber-200/70">Copy these now — the client secret won't be shown again.</p>
		<dl class="mt-3 space-y-2">
			<div>
				<dt class="text-sm font-medium text-slate-300">Client ID</dt>
				<dd class="mt-0.5 break-all rounded-md bg-slate-100 px-3 py-1.5 font-mono text-sm dark:bg-slate-800">{createdSecret.clientId}</dd>
			</div>
			<div>
				<dt class="text-sm font-medium text-slate-300">Client Secret</dt>
				<dd class="mt-0.5 break-all rounded-md bg-slate-100 px-3 py-1.5 font-mono text-sm dark:bg-slate-800">{createdSecret.clientSecret}</dd>
			</div>
		</dl>
		<button class="btn btn-primary mt-3" onclick={() => (createdSecret = null)}>I saved them</button>
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
							<span class="text-slate-400"> — {data.scopeDescriptions[scope]}</span>
						</label>
					{/each}
				</div>
			</div>
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
						<ConfirmButton class="btn btn-ghost btn-ghost-danger btn-sm" message="Delete this client and revoke all its tokens?">Delete</ConfirmButton>
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
				<li class="list-item flex items-center gap-3">
					<div class="min-w-0 flex-1">
						<div class="list-title font-mono text-sm">{t.clientId}</div>
						<div class="meta mt-0.5">Scopes: {t.scopes.join(', ')}</div>
						<div class="meta mt-0.5">
							Created {new Date(t.createdAt).toLocaleDateString()}
							{#if t.lastUsedAt}· Last used {new Date(t.lastUsedAt).toLocaleDateString()}{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}
