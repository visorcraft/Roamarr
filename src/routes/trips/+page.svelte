<script lang="ts">
	let { data } = $props();
	const visBadge: Record<string, string> = {
		private: 'badge-slate',
		groups: 'badge-brand',
		public: 'badge-green'
	};
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-extrabold text-white">Trips</h1>
		<p class="mt-1 text-sm text-muted">
			{data.trips.length} trip{data.trips.length === 1 ? '' : 's'} planned
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<a href="/trips/import" class="btn btn-ghost">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /><path d="M7 11l5 5 5-5" /><path d="M12 4v12" /></svg>
			Import
		</a>
		<a href="/trips/new" class="btn btn-primary">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-4 w-4"><path d="M5 12h14M12 5v14" /></svg>
			New trip
		</a>
	</div>
</header>

<form method="GET" action="/trips" class="mt-6 flex flex-wrap items-end gap-3">
	<label class="field flex-1 min-w-[12rem]">
		<span class="label">Search</span>
		<input type="search" name="q" value={data.q ?? ''} placeholder="Trip name or destination" class="input" />
	</label>
	<label class="field min-w-[8rem]">
		<span class="label">Sort by</span>
		<select name="sort" value={data.sort} class="input">
			<option value="startDate">Start date</option>
			<option value="name">Name</option>
			<option value="createdAt">Created</option>
		</select>
	</label>
	<label class="field min-w-[7rem]">
		<span class="label">Order</span>
		<select name="order" value={data.order} class="input">
			<option value="asc">Ascending</option>
			<option value="desc">Descending</option>
		</select>
	</label>
	<button type="submit" class="btn btn-ghost">Apply</button>
</form>

{#if data.trips.length}
	<div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
		{#each data.trips as t (t.id)}
			<a
				href={`/trips/${t.id}`}
				class="card group flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:ring-white/20"
			>
				<div class="flex items-start justify-between gap-3">
					<h2 class="font-display text-lg leading-tight font-bold text-white">{t.name}</h2>
					{#if t.isShared}
						<span class="badge badge-brand shrink-0">Shared</span>
					{:else}
						<span class="badge {visBadge[t.defaultVisibility] ?? 'badge-slate'} shrink-0 capitalize"
							>{t.defaultVisibility}</span
						>
					{/if}
				</div>
				{#if t.destination}
					<p class="flex items-center gap-1.5 text-sm text-slate-400">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0 text-slate-500"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
						{t.destination}
					</p>
				{/if}
				{#if t.startDate || t.endDate}
					<p class="mt-auto font-mono text-xs text-slate-500">{t.startDate || '—'} → {t.endDate || '—'}</p>
				{/if}
			</a>
		{/each}
	</div>
{:else}
	<div class="card mt-6 grid place-items-center gap-3 p-12 text-center">
		<div class="grid h-12 w-12 place-items-center rounded-full bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-400/20">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" /></svg>
		</div>
		<p class="text-slate-300">No trips yet — plan your first one.</p>
		<a href="/trips/new" class="btn btn-primary mt-1">Create a trip</a>
	</div>
{/if}
