<script lang="ts">
	let { data } = $props();
	const userShares = $derived(data.shares.filter((s) => s.email));
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div class="min-w-0">
		<h1 class="truncate text-3xl font-extrabold text-white">Share trip</h1>
		<p class="mt-1 text-sm text-muted">Control who can see {data.trip.name}.</p>
	</div>
	<a href={`/trips/${data.trip.id}`} class="btn btn-ghost btn-sm">Back to trip</a>
</header>

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Shared with people</h2>
	{#if userShares.length}
		<ul class="divide-y divide-white/5">
			{#each userShares as s (s.id)}
				<li class="flex items-center gap-3 py-3">
					<span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
					</span>
					<span class="truncate text-sm text-slate-200">{s.email}</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="py-4 text-sm text-slate-500">Not shared with anyone yet.</p>
	{/if}

	<form method="POST" action="?/shareUser" class="mt-4 flex flex-wrap items-end gap-3">
		<div class="field min-w-0 flex-1">
			<label class="label" for="email">Invite by email</label>
			<input id="email" name="email" type="email" placeholder="user@example.com" class="input" required />
		</div>
		<button class="btn btn-primary">Share</button>
	</form>
</section>

{#if data.groups.length}
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Share with a group</h2>
		<form method="POST" action="?/shareGroup" class="flex flex-wrap items-end gap-3">
			<div class="field min-w-0 flex-1">
				<label class="label" for="groupId">Group</label>
				<select id="groupId" name="groupId" class="select">
					{#each data.groups as g (g.id)}
						<option value={g.id}>{g.name}</option>
					{/each}
				</select>
			</div>
			<button class="btn btn-primary">Share</button>
		</form>
	</section>
{/if}

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Public link</h2>
	{#if data.trip.publicToken}
		<p class="text-sm text-slate-400">Anyone with this link can view the trip.</p>
		<p class="mt-2 break-all rounded-lg bg-white/[0.03] px-3 py-2 font-mono text-xs text-slate-300 ring-1 ring-white/5">/share/{data.trip.publicToken}</p>
		<form method="POST" action="?/revokePublic" class="mt-3">
			<button class="btn btn-danger btn-sm">Revoke public link</button>
		</form>
	{:else}
		<p class="text-sm text-slate-400">Generate a link that lets anyone view this trip without an account.</p>
		<form method="POST" action="?/makePublic" class="mt-3">
			<button class="btn btn-primary btn-sm">Create public link</button>
		</form>
	{/if}
</section>
