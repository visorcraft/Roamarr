<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';

	let { data } = $props();
	const userShares = $derived(data.shares.filter((s) => s.email));
	const groupShares = $derived(data.shares.filter((s) => s.groupName));
</script>

<header class="page-header">
	<div class="min-w-0">
		<h1 class="page-title truncate">Share trip</h1>
		<p class="page-subtitle">Control who can see {data.trip.name}.</p>
	</div>
	<a href={`/trips/${data.trip.id}`} class="btn btn-ghost">Back to trip</a>
</header>

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Shared with people</h2>
	{#if userShares.length}
		<ul class="divide-y divide-white/5">
			{#each userShares as s (s.id)}
				<li class="flex items-center justify-between gap-3 py-3">
					<div class="flex items-center gap-3 min-w-0">
						<span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
						</span>
						<span class="truncate text-sm text-slate-200">{s.email}</span>
						<span class="badge badge-slate uppercase">{s.permission}</span>
					</div>
					<div class="action-row">
						<form method="POST" action="?/setShowDetails">
							<input type="hidden" name="shareId" value={s.id} />
							<input type="hidden" name="showDetails" value={s.showDetails ? '0' : '1'} />
							<button class="btn btn-ghost">{s.showDetails ? 'Hide details' : 'Show details'}</button>
						</form>
						<form method="POST" action="?/unshareUser">
							<input type="hidden" name="shareId" value={s.id} />
							<ConfirmButton class="btn btn-danger" aria-label="Remove share" message="Remove this share?">Remove</ConfirmButton>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty-text py-4 text-left">Not shared with anyone yet.</p>
	{/if}

	<form method="POST" action="?/shareUser" class="mt-4 flex flex-wrap items-end gap-3">
		<div class="field min-w-0 flex-1">
			<label class="label" for="email">Invite by email</label>
			<input id="email" name="email" type="email" placeholder="user@example.com" class="input" required />
		</div>
		<div class="field w-32">
			<label class="label" for="permission-user">Permission</label>
			<select id="permission-user" name="permission" class="select">
				<option value="read">Read</option>
				<option value="edit">Edit</option>
			</select>
		</div>
		<button class="btn btn-primary">Share</button>
	</form>
</section>

{#if data.groups.length || groupShares.length}
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Shared with groups</h2>
		{#if groupShares.length}
			<ul class="divide-y divide-white/5">
				{#each groupShares as s (s.id)}
					<li class="flex items-center justify-between gap-3 py-3">
						<div class="flex items-center gap-3 min-w-0">
							<span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/20">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
							</span>
							<span class="truncate text-sm text-slate-200">{s.groupName}</span>
							<span class="badge badge-slate uppercase">{s.permission}</span>
						</div>
						<div class="action-row">
							<form method="POST" action="?/setShowDetails">
								<input type="hidden" name="shareId" value={s.id} />
								<input type="hidden" name="showDetails" value={s.showDetails ? '0' : '1'} />
								<button class="btn btn-ghost">{s.showDetails ? 'Hide details' : 'Show details'}</button>
							</form>
							<form method="POST" action="?/unshareGroup">
								<input type="hidden" name="shareId" value={s.id} />
								<ConfirmButton class="btn btn-danger" aria-label="Remove group share" message="Remove this group share?">Remove</ConfirmButton>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty-text py-4 text-left">Not shared with any groups yet.</p>
		{/if}

		{#if data.groups.length}
			<form method="POST" action="?/shareGroup" class="mt-4 flex flex-wrap items-end gap-3">
				<div class="field min-w-0 flex-1">
					<label class="label" for="groupId">Group</label>
					<select id="groupId" name="groupId" class="select">
						{#each data.groups as g (g.id)}
							<option value={g.id}>{g.name}</option>
						{/each}
					</select>
				</div>
				<div class="field w-32">
					<label class="label" for="permission-group">Permission</label>
					<select id="permission-group" name="permission" class="select">
						<option value="read">Read</option>
						<option value="edit">Edit</option>
					</select>
				</div>
				<button class="btn btn-primary">Share</button>
			</form>
		{/if}
	</section>
{/if}

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Public link</h2>
	{#if data.publicShareUrl}
		<p class="text-sm text-slate-400">Anyone with this link can view the trip.</p>
		<div class="mt-2 flex items-center gap-2">
			<p class="code-chip flex-1">/share/{data.trip.publicToken}</p>
			<CopyButton text={data.publicShareUrl} class="btn btn-ghost shrink-0" label="Copy link" />
		</div>
		<form method="POST" action="?/revokePublic" class="mt-3">
			<ConfirmButton class="btn btn-danger" message="Revoke the public link? Anyone with the link will lose access.">Revoke public link</ConfirmButton>
		</form>
	{:else}
		<p class="text-sm text-slate-400">Generate a link that lets anyone view this trip without an account. You can optionally set an expiry.</p>
		<form method="POST" action="?/makePublic" class="mt-3 flex flex-wrap items-end gap-3">
			<div class="field">
				<label class="label" for="publicExpiresAt">Expires (optional)</label>
				<input id="publicExpiresAt" name="publicExpiresAt" type="datetime-local" class="input" />
			</div>
			<button class="btn btn-primary">Create public link</button>
		</form>
	{/if}
</section>
