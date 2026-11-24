<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';

	const { formatDate } = useDateFormat();

	let { data, form } = $props();

	let keyName = $state('');
	let expiresAt = $state('');
	let selectedScopes = $state<string[]>(['trips:read']);
	let dismissedToken = $state<string | null>(null);
	let editingId = $state<number | null>(null);
	let submitting = $state(false);

	const created = $derived(
		form && 'createdToken' in form && String(form.createdToken) !== dismissedToken
			? { token: form.createdToken as string, name: (form.createdName as string) ?? '' }
			: null
	);

	const createKey: SubmitFunction = () => {
		submitting = true;
		return async ({ result, update }) => {
			try {
				await update({ reset: false });
				if (result.type === 'success') {
					keyName = '';
					expiresAt = '';
					selectedScopes = ['trips:read'];
				}
			} finally {
				submitting = false;
			}
		};
	};

	// Group scopes by resource prefix (trips, segments, …) like the OAuth
	// consent screen groups related permissions together.
	const scopeGroups = $derived.by(() => {
		const map = new Map<string, string[]>();
		for (const scope of data.grantableScopes as string[]) {
			const resource = scope.split(':')[0];
			if (!map.has(resource)) map.set(resource, []);
			map.get(resource)!.push(scope);
		}
		return [...map.entries()];
	});

	function humanize(scopes: string[]): string {
		return scopes.map((s) => (data.scopeDescriptions as Record<string, string>)[s] ?? s).join(' · ');
	}
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">API Keys</h1>
		<p class="page-subtitle">Long-lived credentials for scripts and AI agents calling the REST API or MCP.</p>
	</div>
</header>

{#if form?.error}<p class="notice notice-error mt-6" role="alert">{form.error}</p>{/if}

{#if created}
	<section class="notice notice-warning mt-6 p-5">
		<h2 class="section-title mb-2">Save your API key</h2>
		<p class="field-help">Copy it now — this token won't be shown again. Roamarr stores only its hash.</p>
		<div class="mt-3 flex items-center gap-2 rounded-lg bg-surface2 p-3">
			<code class="min-w-0 flex-1 break-all font-mono text-sm text-ink">{created.token}</code>
			<CopyButton text={created.token} class="btn btn-ghost btn-sm shrink-0" />
		</div>
		<p class="field-help mt-2">
			Use it as <code>X-Api-Token: {created.token.slice(0, 10)}…</code> or <code>Authorization: Bearer {created.token.slice(0, 10)}…</code> on <code>/api/*</code> and <code>/mcp</code>.
		</p>
		<button class="btn btn-primary mt-3" onclick={() => (dismissedToken = created.token)}>I saved it</button>
	</section>
{/if}

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title mb-4">Create a new key</h2>
	<form
		method="POST"
		action="?/create"
		class="space-y-4"
		use:enhance={createKey}
		aria-busy={submitting}
	>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="field">
				<label class="label" for="keyName">Name</label>
				<input id="keyName" name="name" bind:value={keyName} placeholder="e.g. CI script, Claude" class="input" required disabled={submitting} />
			</div>
			<div class="field">
				<label class="label" for="expiresAt">Expires (optional)</label>
				<input id="expiresAt" name="expiresAt" type="date" bind:value={expiresAt} class="input" aria-describedby="expiresAt-hint" disabled={submitting} />
				<p id="expiresAt-hint" class="field-help mt-1">Leave empty for a key that never expires.</p>
			</div>
		</div>
		<div class="field" role="group" aria-labelledby="scopes-label" aria-describedby="scopes-help">
			<span class="label" id="scopes-label">Scopes</span>
			<p id="scopes-help" class="field-help mt-1">The key can only do what the selected scopes allow. Admin capabilities can never be granted to API keys.</p>
			<div class="mt-3 space-y-3">
				{#each scopeGroups as [resource, scopes] (resource)}
					<div>
						<div class="label">{resource}</div>
						<div class="mt-1 grid gap-1 sm:grid-cols-2">
							{#each scopes as scope (scope)}
								<label class="checkbox-label text-sm">
									<input
										type="checkbox"
										name="scopes"
										value={scope}
										class="checkbox"
										checked={selectedScopes.includes(scope)}
										disabled={submitting}
										onchange={(e) => {
											if (e.currentTarget.checked) selectedScopes = [...selectedScopes, scope];
											else selectedScopes = selectedScopes.filter((s) => s !== scope);
										}}
									/>
									<span class="font-medium">{scope}</span>
									<span class="text-muted"> — {(data.scopeDescriptions as Record<string, string>)[scope]}</span>
								</label>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
		<div class="flex justify-end">
			<button type="submit" class="btn btn-primary" disabled={submitting} class:btn-loading={submitting}>{submitting ? 'Creating…' : 'Create key'}</button>
		</div>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title mb-4">Your keys</h2>
	{#if data.keys.length}
		<ul class="list-stack">
			{#each data.keys as key (key.id)}
				<li class="list-item flex items-start gap-3" class:opacity-60={key.revoked}>
					<div class="min-w-0 flex-1">
						{#if editingId === key.id}
							<form method="POST" action="?/rename" class="flex items-center justify-end gap-2">
								<input type="hidden" name="id" value={key.id} />
								<input name="name" value={key.name} class="input min-w-0 flex-1" placeholder="Name" />
								<button class="btn btn-primary btn-sm">Save</button>
							</form>
						{:else}
							<div class="list-title">
								{key.name}
								{#if key.revoked}<span class="meta">· revoked</span>{/if}
							</div>
							<div class="meta mt-0.5" title={key.scopes.join(', ')}>Scopes: {humanize(key.scopes)}</div>
							<div class="meta mt-0.5">
								Created {formatDate(key.createdAt)}
								{#if key.expiresAt}· Expires {formatDate(key.expiresAt)}{/if}
								{#if key.lastUsedAt}· Last used {formatDate(key.lastUsedAt)}{/if}
							</div>
						{/if}
					</div>
					{#if !key.revoked && editingId !== key.id}
						<div class="flex gap-1">
							<button type="button" class="btn btn-primary btn-sm" onclick={() => { editingId = key.id; }}>Rename</button>
							<form method="POST" action="?/revoke">
								<input type="hidden" name="id" value={key.id} />
								<ConfirmButton class="btn btn-danger btn-sm" message="Revoke this API key? Scripts using it will stop working immediately.">Revoke</ConfirmButton>
							</form>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text">No API keys yet.</p>
	{/if}
</section>
