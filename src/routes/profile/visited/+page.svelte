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
	</section>
{:else}
	<section class="card mt-4 p-5">
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
