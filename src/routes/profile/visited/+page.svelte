<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import { COUNTRIES } from '$lib/countries';
	import { US_STATES } from '$lib/usStates';
	import { page } from '$app/state';

	let { data } = $props();

	const visitedCountryCodes = $derived(new Set(data.countries.map((c) => c.code)));
	const visitedStateCodes = $derived(new Set(data.usStates.map((s) => s.code)));
	let tab = $state<'country' | 'state'>('country');
	let query = $state('');
	const today = new Date().toISOString().slice(0, 10);

	const filteredCountries = $derived(
		query.trim()
			? COUNTRIES.filter(
					(c) =>
						c.name.toLowerCase().includes(query.toLowerCase()) ||
						c.code.toLowerCase().includes(query.toLowerCase())
				)
			: COUNTRIES
	);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Visited places</h1>
		<p class="page-subtitle">
			{visitedCountryCodes.size} of {COUNTRIES.length} countries
			&middot; {visitedStateCodes.size} of {US_STATES.length} U.S. states
		</p>
	</div>
	<div class="ml-auto flex items-center gap-4">
		<form method="POST" action="?/toggleAutoMark">
			<button class="btn btn-ghost btn-sm {data.autoMarkVisited ? 'text-brand' : ''}">
				Auto-mark: {data.autoMarkVisited ? 'ON' : 'OFF'}
			</button>
		</form>
		<form method="POST" action="?/autoMark">
			<button class="btn btn-ghost">Mark from past trips</button>
		</form>
	</div>
</header>

<div class="tab-list mt-4">
	<button class="tab-link {tab === 'country' ? 'tab-link-active' : ''}" onclick={() => (tab = 'country')}>Countries</button>
	<button class="tab-link {tab === 'state' ? 'tab-link-active' : ''}" onclick={() => (tab = 'state')}>U.S. States</button>
</div>

{#if tab === 'country'}
	<section class="card mt-4 p-5">
		<form method="POST" action="?/mark" class="mb-5 flex flex-wrap items-end gap-3">
			<input type="hidden" name="kind" value="country" />
			<label class="flex flex-col gap-1">
				<span class="text-sm text-muted">Country</span>
				<select name="code" class="input w-56" required>
					<option value="" disabled selected>Choose a country…</option>
					{#each COUNTRIES.filter((c) => !visitedCountryCodes.has(c.code)) as c (c.code)}
						<option value={c.code}>{c.name} ({c.code})</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-sm text-muted">Visited on</span>
				<input type="date" name="visited_on" value={today} class="input" required />
			</label>
			<button type="submit" class="btn btn-primary">Add visit</button>
		</form>

		<div class="mb-4 flex items-center gap-3">
			<input
				bind:value={query}
				placeholder="Filter countries…"
				class="input max-w-xs"
				type="search"
			/>
			{#if visitedCountryCodes.size > 0}
				<form method="POST" action="?/clear" class="ml-auto">
					<input type="hidden" name="kind" value="country" />
					<ConfirmButton class="btn btn-ghost btn-ghost-danger" message="Clear all visited countries?">
						Clear all
					</ConfirmButton>
				</form>
			{/if}
		</div>
		<div class="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each filteredCountries as c (c.code)}
				{#if visitedCountryCodes.has(c.code)}
					<form method="POST" action="?/unmark">
						<input type="hidden" name="kind" value="country" />
						<input type="hidden" name="code" value={c.code} />
						<button
							type="submit"
							class="badge badge-brand badge-compact w-full justify-start rounded-md text-left transition hover:opacity-80"
							aria-pressed="true"
						>
							<span class="font-mono text-[10px] opacity-70">{c.code}</span>
							<span class="truncate">{c.name}</span>
						</button>
					</form>
				{:else}
					<form method="POST" action="?/mark">
						<input type="hidden" name="kind" value="country" />
						<input type="hidden" name="code" value={c.code} />
						<button
							type="submit"
							class="badge badge-slate badge-compact w-full justify-start rounded-md text-left font-normal transition hover:opacity-80"
							aria-pressed="false"
						>
							<span class="font-mono text-[10px] opacity-70">{c.code}</span>
							<span class="truncate">{c.name}</span>
						</button>
					</form>
				{/if}
			{/each}
		</div>

		{#if data.summaries.length > 0}
			<div class="mt-6">
				<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Country summary</h2>
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-muted">
								<th class="pb-2">Country</th>
								<th class="pb-2">First visit</th>
								<th class="pb-2">Last visit</th>
								<th class="pb-2">Trips</th>
							</tr>
						</thead>
						<tbody>
							{#each data.summaries as s (s.code)}
								<tr class="border-t">
									<td class="py-2 font-medium">{s.code}</td>
									<td class="py-2">{s.firstAt ?? '—'}</td>
									<td class="py-2">{s.lastAt ?? '—'}</td>
									<td class="py-2">{s.tripCount}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</section>
{:else}
	<section class="card mt-4 p-5">
		<form method="POST" action="?/mark" class="mb-5 flex flex-wrap items-end gap-3">
			<input type="hidden" name="kind" value="state" />
			<label class="flex flex-col gap-1">
				<span class="text-sm text-muted">U.S. state</span>
				<select name="code" class="input w-56" required>
					<option value="" disabled selected>Choose a state…</option>
					{#each US_STATES.filter((s) => !visitedStateCodes.has(s.code)) as s (s.code)}
						<option value={s.code}>{s.name} ({s.code})</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-sm text-muted">Visited on</span>
				<input type="date" name="visited_on" value={today} class="input" required />
			</label>
			<button type="submit" class="btn btn-primary">Add visit</button>
		</form>
		<div class="mb-4 flex items-center gap-3">
			<span class="text-sm text-muted">Toggle states you have visited</span>
			{#if visitedStateCodes.size > 0}
				<form method="POST" action="?/clear" class="ml-auto">
					<input type="hidden" name="kind" value="state" />
					<ConfirmButton class="btn btn-ghost btn-ghost-danger" message="Clear all visited states?">
						Clear all
					</ConfirmButton>
				</form>
			{/if}
		</div>
		<div class="grid grid-cols-3 gap-1 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9">
			{#each US_STATES as s (s.code)}
				{#if visitedStateCodes.has(s.code)}
					<form method="POST" action="?/unmark">
						<input type="hidden" name="kind" value="state" />
						<input type="hidden" name="code" value={s.code} />
						<button
							type="submit"
							class="badge badge-brand badge-compact w-full justify-center rounded-md transition hover:opacity-80"
							aria-pressed="true"
							title={s.name}
						>
							{s.code}
						</button>
					</form>
				{:else}
					<form method="POST" action="?/mark">
						<input type="hidden" name="kind" value="state" />
						<input type="hidden" name="code" value={s.code} />
						<button
							type="submit"
							class="badge badge-slate badge-compact w-full justify-center rounded-md font-normal transition hover:opacity-80"
							aria-pressed="false"
							title={s.name}
						>
							{s.code}
						</button>
					</form>
				{/if}
			{/each}
		</div>
	</section>
{/if}

{#if page.status === 200 && data.countries.length === 0 && data.usStates.length === 0}
	<p class="meta mt-6">
		Tip: use <strong>Mark from past trips</strong> to automatically add countries you've already
		visited based on your trip history.
	</p>
{/if}
