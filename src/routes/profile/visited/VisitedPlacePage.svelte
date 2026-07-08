<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { html } from 'gridjs';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import GridTable, { type FetchOpts, type GridFilter } from '$lib/components/GridTable.svelte';
	import { COUNTRIES } from '$lib/countries';
	import { countryContinent, continentSortKey } from '$lib/countryContinents';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';
	import { escapeHtml } from '$lib/escapeHtml';
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
	const tableRows = $derived((data.tableRows ?? data.rows) as Record<string, unknown>[]);
	const editingRow = $derived(tableRows.find((row) => row.code === editingCode));
	let tableError: string | null = $state(null);
	const { formatDate } = useDateFormat();
	const dateFilters: GridFilter[] = [
		{ id: 'from', label: 'From', type: 'date' },
		{ id: 'to', label: 'To', type: 'date' }
	];

	const columns = $derived([
		{
			id: 'name',
			name: isCountry ? 'Country' : 'State',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<div class="font-medium" style="color: var(--theme-strong)">${escapeHtml(row.name)}</div>` +
						`<div class="text-xs" style="color: var(--theme-readable-faint)">${escapeHtml(row.displayCode)}</div>`
				)
		},
		{
			id: 'firstVisitedOn',
			name: 'First visited',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.firstVisitedOn
					? html(`<span style="color: var(--theme-readable-muted)">${escapeHtml(formatDate(String(row.firstVisitedOn)))}</span>`)
					: html('<span style="color: var(--theme-readable-faint)">—</span>')
		},
		{
			id: 'lastVisitedOn',
			name: 'Last visited',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				row.lastVisitedOn
					? html(`<span style="color: var(--theme-readable-muted)">${escapeHtml(formatDate(String(row.lastVisitedOn)))}</span>`)
					: html('<span style="color: var(--theme-readable-faint)">—</span>')
		},
		{
			id: 'source',
			name: 'Source',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(`<span style="color: var(--theme-readable)">${escapeHtml(row.source)}</span>`)
		}
	]);

	const tableActions = $derived([
		{ id: 'edit', label: 'Edit' },
		{
			id: 'remove',
			label: 'Remove',
			variant: 'danger' as const,
			confirm: true,
			confirmTitle: `Remove visited ${noun}`,
			confirmMessage: (row: Record<string, unknown>) => `Remove ${row.name}?`,
			confirmLabel: 'Remove'
		}
	]);

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

	function compareValue(row: Record<string, unknown>, key: string) {
		return String(row[key] ?? '').toLowerCase();
	}

	async function fetchData(opts: FetchOpts) {
		const search = String(opts.url.search ?? '').trim().toLowerCase();
		const from = String(opts.url.from ?? '');
		const to = String(opts.url.to ?? '');
		const sort = opts.url.sort;
		const dir = opts.url.dir === 'desc' ? -1 : 1;
		const page = Number(opts.url.page ?? 0);
		const limit = Number(opts.url.limit ?? 25);
		let rows = [...tableRows];
		if (search) {
			rows = rows.filter((row) =>
				['name', 'code', 'displayCode', 'firstVisitedOn', 'lastVisitedOn', 'source'].some((key) =>
					compareValue(row, key).includes(search)
				)
			);
		}
		if (from || to) {
			rows = rows.filter((row) => {
				const first = String(row.firstVisitedOn ?? row.lastVisitedOn ?? '');
				const last = String(row.lastVisitedOn ?? row.firstVisitedOn ?? '');
				if (!first || !last) return false;
				return (!from || last >= from) && (!to || first <= to);
			});
		}
		if (sort) {
			rows.sort((a, b) => compareValue(a, sort).localeCompare(compareValue(b, sort)) * dir);
		}
		return { rows: rows.slice(page * limit, page * limit + limit), total: rows.length };
	}

	function startAdding() {
		tableError = null;
		editingCode = null;
		adding = true;
	}

	async function postAction(action: string, code: string) {
		const body = new FormData();
		body.set('returnTo', data.currentPath);
		body.set('code', code);
		const res = await fetch(`?/${action}`, { method: 'POST', body });
		if (!res.ok) {
			tableError = `${action === 'unmark' ? 'Remove' : 'Update'} failed.`;
			return;
		}
		editingCode = null;
		await invalidateAll();
	}

	async function handleTableAction(e: Event) {
		tableError = null;
		const { action, row } = (e as CustomEvent<{ action: string; row: Record<string, unknown> }>).detail;
		if (action === 'edit') {
			adding = false;
			editingCode = String(row.code);
		} else if (action === 'remove') {
			await postAction('unmark', String(row.code));
		}
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

<div class="tab-list visited-tab-list mt-6">
	<a href={href({ tab: null, page: null })} class="tab-link {data.tab === 'visits' ? 'tab-link-active' : ''}">Visits</a>
	<a href={href({ tab: 'list', page: null })} class="tab-link {data.tab === 'list' ? 'tab-link-active' : ''}">{listLabel}</a>
</div>

{#if data.tab === 'visits'}
	<section class="card visited-tab-panel p-5 sm:p-6">
		{#if tableError}<p class="notice notice-error mb-4">{tableError}</p>{/if}

		{#if adding}
			<form method="POST" action="?/mark" class="mb-5 grid gap-3 sm:grid-cols-4">
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
				<div class="flex items-center justify-end gap-2 sm:col-span-4">
					<button type="button" class="btn btn-ghost" onclick={() => (adding = false)}>Cancel</button>
					<button class="btn btn-primary">Save visit</button>
				</div>
			</form>
		{/if}

		{#if editingRow}
			<form method="POST" action="?/update" class="mb-5 grid gap-3 sm:grid-cols-5">
				<input type="hidden" name="returnTo" value={data.currentPath} />
				<input type="hidden" name="code" value={editingRow.code as string} />
				<div class="sm:col-span-2">
					<p class="list-title">{editingRow.name as string}</p>
					<p class="meta">{editingRow.displayCode as string}</p>
				</div>
				<label class="field">
					<span class="label">First visited</span>
					<input type="date" name="firstVisitedOn" value={(editingRow.firstVisitedOn as string | null) ?? ''} class="input" />
				</label>
				<label class="field">
					<span class="label">Last visited</span>
					<input type="date" name="lastVisitedOn" value={(editingRow.lastVisitedOn as string | null) ?? ''} class="input" />
				</label>
				<div class="flex items-end justify-end gap-2">
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => (editingCode = null)}>Cancel</button>
					<button class="btn btn-primary btn-sm">Save</button>
				</div>
			</form>
		{/if}

		<GridTable
			{columns}
			{fetchData}
			actions={tableActions}
			filters={dateFilters}
			getRowId={(row) => row.code}
			addLabel="Add Visit"
			onadd={!adding ? startAdding : undefined}
			emptyMessage={`No visited ${plural} found.`}
			onaction={handleTableAction}
		/>
	</section>
{:else}
	<section class="card visited-tab-panel p-5 sm:p-6">
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
