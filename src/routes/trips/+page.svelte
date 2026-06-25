<script lang="ts">
	import { parseTags } from '$lib/tags';

	let { data, form }: { data: { trips: { id: number; name: string; destination: string; startDate: string; endDate: string; tags: string | string[]; archived?: boolean; favorite?: boolean; defaultVisibility?: string; isShared?: boolean }[]; q?: string; tag?: string; sort: string; order: string; filter: string }; form?: { error?: string } } = $props();

	const allTags = $derived(
		Array.from(
			new Set(data.trips.flatMap((t) => parseTags(t.tags).map((x) => x.toLowerCase())))
		).sort()
	);

	const visBadge: Record<string, string> = {
		private: 'badge-slate',
		groups: 'badge-brand',
		public: 'badge-green'
	};
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Trips</h1>
		<p class="page-subtitle">
			{data.trips.length} trip{data.trips.length === 1 ? '' : 's'} planned
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<a href="/trips/import" class="btn btn-ghost">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /><path d="M7 11l5 5 5-5" /><path d="M12 4v12" /></svg>
			Import
		</a>
		<a href="/trips/export" class="btn btn-ghost">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /><path d="M7 9l5-5 5 5" /><path d="M12 4v12" /></svg>
			Export
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
		<input type="search" name="q" value={data.q ?? ''} placeholder="Trip, destination, or segment" class="input" />
	</label>
	<label class="field min-w-[8rem]">
		<span class="label">Tag</span>
		<input type="text" name="tag" value={data.tag ?? ''} placeholder="e.g. work" class="input" />
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

<div class="mt-4 flex gap-2">
	<a href="?filter=active" class="btn btn-sm {data.filter === 'active' ? 'btn-primary' : 'btn-ghost'}">Active</a>
	<a href="?filter=archived" class="btn btn-sm {data.filter === 'archived' ? 'btn-primary' : 'btn-ghost'}">Archived</a>
	<a href="?filter=favorites" class="btn btn-sm {data.filter === 'favorites' ? 'btn-primary' : 'btn-ghost'}">Favorites</a>
</div>

{#if allTags.length}
	<div class="mt-3 flex flex-wrap gap-1.5">
		{#each allTags as tag}
			<a href="?tag={tag}" class="badge badge-slate text-xs {data.tag === tag ? 'badge-brand' : ''}">{tag}</a>
		{/each}
	</div>
{/if}

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

{#if data.trips.length}
	<form method="POST" class="mt-6">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm text-slate-400">Select your own trips to manage them in bulk.</p>
			<div class="flex flex-wrap gap-2">
				<button formaction="?/favorite" class="btn btn-ghost">Favorite</button>
				<button formaction="?/archive" class="btn btn-ghost">Archive</button>
				<button formaction="?/unfavorite" class="btn btn-ghost">Unfavorite</button>
				<button formaction="?/unarchive" class="btn btn-ghost">Unarchive</button>
				<button formaction="?/delete" class="btn btn-danger">Delete</button>
			</div>
		</div>
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each data.trips as t (t.id)}
				<div class="card group relative flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:ring-white/20">
					{#if !t.isShared}
						<input
							type="checkbox"
							name="selected"
							value={t.id}
							class="checkbox absolute top-3 right-3"
							onclick={(e) => e.stopPropagation()}
						/>
					{/if}
					<a href={`/trips/${t.id}`} class="contents">
						<div class="flex items-start justify-between gap-3">
							<h2 class="section-title">
								{#if t.favorite}<span class="text-yellow-400" title="Favorite">★</span>{/if}
								{t.name}
							</h2>
							{#if t.isShared}
								<span class="badge badge-brand shrink-0">Shared</span>
							{:else}
								{@const badgeClass = t.defaultVisibility ? visBadge[t.defaultVisibility] ?? 'badge-slate' : 'badge-slate'}
								<span class="badge {badgeClass} shrink-0 capitalize">{t.defaultVisibility || 'private'}</span>
							{/if}
						</div>
						{#if t.destination}
							<p class="flex items-center gap-1.5 text-sm text-slate-400">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0 text-slate-500"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
								{t.destination}
							</p>
						{/if}
						{#if parseTags(t.tags).length}
							<div class="flex flex-wrap gap-1.5">
								{#each parseTags(t.tags) as tag}
									<span class="badge badge-slate text-xs">{tag}</span>
								{/each}
							</div>
						{/if}
						{#if t.startDate || t.endDate}
							<p class="mt-auto font-mono text-xs text-slate-500">{t.startDate || '—'} → {t.endDate || '—'}</p>
						{/if}
					</a>
				</div>
			{/each}
		</div>
	</form>
{:else}
	<div class="empty-state">
		<div class="empty-icon">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" /></svg>
		</div>
		<p class="text-slate-300">No trips yet — plan your first one.</p>
		<a href="/trips/new" class="btn btn-primary mt-1">Create a trip</a>
	</div>
{/if}
