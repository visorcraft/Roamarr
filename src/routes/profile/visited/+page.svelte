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
			<button class="btn btn-ghost btn-sm {data.autoMarkVisited ? 'text-indigo-400' : ''}">
				Auto-mark: {data.autoMarkVisited ? 'ON' : 'OFF'}
			</button>
		</form>
		<form method="POST" action="?/autoMark">
			<button class="btn btn-ghost">Mark from past trips</button>
		</form>
	</div>
</header>

<div class="mt-4 inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-600">
	<button
		class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {tab === 'country'
			? 'bg-indigo-600 text-white'
			: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}"
		onclick={() => (tab = 'country')}>Countries</button
	>
	<button
		class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {tab === 'state'
			? 'bg-indigo-600 text-white'
			: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}"
		onclick={() => (tab = 'state')}>U.S. States</button
	>
</div>

{#if tab === 'country'}
	<section class="card mt-4 p-5">
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
							class="flex w-full items-center gap-1.5 rounded-md border border-indigo-500 bg-indigo-50 px-2.5 py-1.5 text-left text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-200 dark:hover:bg-indigo-900"
							aria-pressed="true"
						>
							<span class="font-mono text-[10px] text-indigo-400 dark:text-indigo-500">{c.code}</span>
							<span class="truncate">{c.name}</span>
						</button>
					</form>
				{:else}
					<form method="POST" action="?/mark">
						<input type="hidden" name="kind" value="country" />
						<input type="hidden" name="code" value={c.code} />
						<button
							type="submit"
							class="flex w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
							aria-pressed="false"
						>
							<span class="font-mono text-[10px] text-slate-400 dark:text-slate-500">{c.code}</span>
							<span class="truncate">{c.name}</span>
						</button>
					</form>
				{/if}
			{/each}
		</div>
	</section>
{:else}
	<section class="card mt-4 p-5">
		<div class="mb-4 flex items-center gap-3">
			<span class="text-sm text-slate-500 dark:text-slate-400">Toggle states you have visited</span>
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
							class="rounded-md border border-indigo-500 bg-indigo-50 px-2 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-200 dark:hover:bg-indigo-900"
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
							class="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
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
