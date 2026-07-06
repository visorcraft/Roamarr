<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import { COUNTRIES } from '$lib/countries';
	import { countryContinent, continentSortKey } from '$lib/countryContinents';
	import { US_STATES, usStateDisplayCode } from '$lib/usStates';

	let { data, form, kind }: { data: any; form?: { error?: string } | null; kind: 'country' | 'state' } = $props();

	let adding = $state(false);
	let editingCode = $state<string | null>(null);

	const isCountry = $derived(kind === 'country');
	const pageHref = $derived(isCountry ? '/profile/visited/countries' : '/profile/visited/states');
	const title = $derived(isCountry ? 'Visited countries' : 'Visited U.S. states');
	const noun = $derived(isCountry ? 'country' : 'U.S. state');
	const plural = $derived(isCountry ? 'countries' : 'U.S. states');
	const listLabel = $derived(isCountry ? 'Country List' : 'State List');
	const visitedCodes = $derived(new Set<string>(data.visitedCodes));
	const rowsStart = $derived(data.totalRows === 0 ? 0 : (data.page - 1) * 20 + 1);
	const rowsEnd = $derived(Math.min(data.page * 20, data.totalRows));

	function href(params: Record<string, string | number | null>) {
		const search = new URLSearchParams();
		if (data.q) search.set('q', data.q);
		if (data.page > 1) search.set('page', String(data.page));
		if (data.tab === 'list') search.set('tab', 'list');
		for (const [key, value] of Object.entries(params)) {
			if (value == null || value === '') search.delete(key);
			else search.set(key, String(value));
		}
		const qs = search.toString();
		return qs ? `${pageHref}?${qs}` : pageHref;
	}

	type Country = (typeof COUNTRIES)[number];
	const countriesByContinent = $derived.by(() => {
		const groups: Record<string, Country[]> = {};
		for (const c of COUNTRIES) {
			const continent = countryContinent(c.code);
			(groups[continent] ??= []).push(c);
		}
		return groups;
	});
	const sortedContinents = $derived(
		Object.keys(countriesByContinent).sort((a, b) => continentSortKey(a) - continentSortKey(b))
	);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">{title}</h1>
		<p class="page-subtitle">
			{data.countryCount} of {COUNTRIES.length} countries &middot; {data.stateCount} of {US_STATES.length} U.S. states
		</p>
	</div>
	<div class="ml-auto flex flex-wrap items-center gap-3">
		<form method="POST" action="?/toggleAutoMark">
			<input type="hidden" name="returnTo" value={data.currentPath} />
			<button class="btn btn-ghost {data.autoMarkVisited ? 'text-brand' : ''}">
				Auto-mark: {data.autoMarkVisited ? 'ON' : 'OFF'}
			</button>
		</form>
		<form method="POST" action="?/autoMark">
			<input type="hidden" name="returnTo" value={data.currentPath} />
			<button class="btn btn-primary">Mark from past trips</button>
		</form>
	</div>
</header>

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

<div class="tab-list mt-6">
	<a href={href({ tab: null, page: null })} class="tab-link {data.tab === 'visits' ? 'tab-link-active' : ''}">Visits</a>
	<a href={href({ tab: 'list', page: null })} class="tab-link {data.tab === 'list' ? 'tab-link-active' : ''}">{listLabel}</a>
</div>

{#if data.tab === 'visits'}
	<section class="card mt-4 p-5 sm:p-6">
		<div class="flex flex-wrap items-center gap-3">
			<form method="GET" action={pageHref} class="flex flex-wrap items-center gap-2">
				<input class="input w-64" type="search" name="q" value={data.q} placeholder={`Search ${plural}...`} />
				<button class="btn btn-secondary" type="submit">Search</button>
				{#if data.q}<a class="btn btn-ghost" href={pageHref}>Clear</a>{/if}
			</form>
			{#if !adding}
				<button type="button" class="btn btn-primary ml-auto" onclick={() => (adding = true)}>
					Add Visit
				</button>
			{/if}
		</div>

		{#if adding}
			<form method="POST" action="?/mark" class="mt-5 grid gap-3 sm:grid-cols-4">
				<input type="hidden" name="returnTo" value={data.currentPath} />
				<label class="field sm:col-span-2">
					<span class="label">{isCountry ? 'Country' : 'U.S. state'}</span>
					<select name="code" class="input" required>
						<option value="" disabled selected>Choose {noun}...</option>
						{#each data.options.filter((option: any) => !visitedCodes.has(option.code)) as option (option.code)}
							<option value={option.code}>{option.name} ({option.displayCode})</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span class="label">First visited</span>
					<input type="date" name="firstVisitedOn" value={data.today} class="input" />
				</label>
				<label class="field">
					<span class="label">Last visited</span>
					<input type="date" name="lastVisitedOn" value={data.today} class="input" />
				</label>
				<div class="flex items-center gap-2 sm:col-span-4">
					<button type="button" class="btn btn-ghost" onclick={() => (adding = false)}>Cancel</button>
					<button class="btn btn-primary">Save visit</button>
				</div>
			</form>
		{/if}

		<div class="mt-5 overflow-x-auto">
			<table class="table min-w-[44rem]">
				<thead>
					<tr>
						<th>{isCountry ? 'Country' : 'State'}</th>
						<th>First visited</th>
						<th>Last visited</th>
						<th>Source</th>
						<th class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.rows as row (row.code)}
						{#if editingCode === row.code}
							<tr>
								<td colspan="5" class="table-expanded-cell">
									<form method="POST" action="?/update" class="grid gap-3 sm:grid-cols-5">
										<input type="hidden" name="returnTo" value={data.currentPath} />
										<input type="hidden" name="code" value={row.code} />
										<div class="sm:col-span-2">
											<p class="list-title">{row.name}</p>
											<p class="meta">{row.displayCode}</p>
										</div>
										<label class="field">
											<span class="label">First visited</span>
											<input type="date" name="firstVisitedOn" value={row.firstVisitedOn ?? ''} class="input" />
										</label>
										<label class="field">
											<span class="label">Last visited</span>
											<input type="date" name="lastVisitedOn" value={row.lastVisitedOn ?? ''} class="input" />
										</label>
										<div class="flex items-end gap-2">
											<button class="btn btn-primary btn-sm">Save</button>
											<button type="button" class="btn btn-ghost btn-sm" onclick={() => (editingCode = null)}>Cancel</button>
										</div>
									</form>
								</td>
							</tr>
						{:else}
							<tr>
								<td>
									<p class="font-semibold">{row.name}</p>
									<p class="meta">{row.displayCode}</p>
								</td>
								<td>{row.firstVisitedOn ?? '-'}</td>
								<td>{row.lastVisitedOn ?? '-'}</td>
								<td><span class="badge badge-slate">{row.source}</span></td>
								<td>
									<div class="flex justify-end gap-2">
										<button type="button" class="btn btn-primary btn-sm" onclick={() => (editingCode = row.code)}>Edit</button>
										<form method="POST" action="?/unmark">
											<input type="hidden" name="returnTo" value={data.currentPath} />
											<input type="hidden" name="code" value={row.code} />
											<ConfirmButton class="btn btn-danger btn-sm" message={`Remove ${row.name}?`}>Remove</ConfirmButton>
										</form>
									</div>
								</td>
							</tr>
						{/if}
					{:else}
						<tr>
							<td colspan="5" class="text-center">No visited {plural} found.</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-4 flex flex-wrap items-center gap-3">
			<p class="meta">Showing {rowsStart}-{rowsEnd} of {data.totalRows}</p>
			<div class="ml-auto flex gap-2">
				<a class="btn btn-ghost btn-sm {data.page <= 1 ? 'pointer-events-none opacity-50' : ''}" href={href({ page: data.page - 1 })}>Previous</a>
				<a class="btn btn-ghost btn-sm {data.page >= data.totalPages ? 'pointer-events-none opacity-50' : ''}" href={href({ page: data.page + 1 })}>Next</a>
			</div>
		</div>
	</section>
{:else}
	<section class="card mt-4 p-5 sm:p-6">
		<div class="mb-4 flex flex-wrap items-center gap-3">
			<p class="meta">Toggle {plural} you have visited.</p>
			{#if data.visitedCodes.length > 0}
				<form method="POST" action="?/clear" class="ml-auto">
					<input type="hidden" name="returnTo" value={data.currentPath} />
					<ConfirmButton class="btn btn-danger" message={`Clear all visited ${plural}?`}>Clear all</ConfirmButton>
				</form>
			{/if}
		</div>

		{#if isCountry}
			{#each sortedContinents as continent (continent)}
				<div class="mb-4">
					<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{continent}</h2>
					<div class="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
						{#each countriesByContinent[continent] as c (c.code)}
							<form method="POST" action={visitedCodes.has(c.code) ? '?/unmark' : '?/mark'}>
								<input type="hidden" name="returnTo" value={data.currentPath} />
								<input type="hidden" name="code" value={c.code} />
								<button class="badge {visitedCodes.has(c.code) ? 'badge-brand' : 'badge-slate'} badge-compact w-full cursor-pointer justify-start rounded-md text-left transition hover:opacity-80">
									<span class="font-mono text-[10px] opacity-70">{c.code}</span>
									<span class="truncate">{c.name}</span>
								</button>
							</form>
						{/each}
					</div>
				</div>
			{/each}
		{:else}
			<div class="grid grid-cols-3 gap-1 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9">
				{#each US_STATES as s (s.code)}
					<form method="POST" action={visitedCodes.has(s.code) ? '?/unmark' : '?/mark'}>
						<input type="hidden" name="returnTo" value={data.currentPath} />
						<input type="hidden" name="code" value={s.code} />
						<button
							class="badge {visitedCodes.has(s.code) ? 'badge-brand' : 'badge-slate'} badge-compact w-full cursor-pointer justify-center rounded-md transition hover:opacity-80"
							title={s.name}
						>
							{usStateDisplayCode(s.code)}
						</button>
					</form>
				{/each}
			</div>
		{/if}
	</section>
{/if}
