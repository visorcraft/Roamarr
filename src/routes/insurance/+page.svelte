<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';

	let { data } = $props();
	let editingId = $state<number | null>(null);

	const tripName: Record<number, string> = $derived(
		Object.fromEntries(data.trips.map((t) => [t.id, t.name]))
	);
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-extrabold text-white">Insurance policies</h1>
		<p class="mt-1 text-sm text-muted">
			{data.policies.length} polic{data.policies.length === 1 ? 'y' : 'ies'} on file
		</p>
	</div>
</header>

{#if data.policies.length}
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Your policies</h2>
		<ul class="space-y-2">
			{#each data.policies as p (p.id)}
				<li class="flex items-start gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
					<span class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4.5 w-4.5"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" /></svg>
					</span>
					{#if editingId === p.id}
						<form method="POST" action="?/update" class="min-w-0 flex-1">
							<input type="hidden" name="id" value={p.id} />
							<div class="grid gap-4 sm:grid-cols-2">
								<div class="field">
									<label class="label" for={`provider-${p.id}`}>Provider</label>
									<input id={`provider-${p.id}`} name="provider" value={p.provider} class="input" required />
								</div>
								<div class="field">
									<label class="label" for={`policyNumber-${p.id}`}>Policy #</label>
									<input id={`policyNumber-${p.id}`} name="policyNumber" value={p.policyNumber ?? ''} class="input" />
								</div>
								<div class="field sm:col-span-2">
									<label class="label" for={`coverageSummary-${p.id}`}>Coverage summary</label>
									<textarea id={`coverageSummary-${p.id}`} name="coverageSummary" class="textarea">{p.coverageSummary ?? ''}</textarea>
								</div>
								<div class="field">
									<label class="label" for={`coverageAmount-${p.id}`}>Coverage (cents)</label>
									<input id={`coverageAmount-${p.id}`} name="coverageAmount" type="number" value={p.coverageAmount ?? ''} class="input" />
								</div>
								<div class="field">
									<label class="label" for={`tripId-${p.id}`}>Trip</label>
									<select id={`tripId-${p.id}`} name="tripId" class="select">
										<option value="" selected={p.tripId == null}>No trip</option>
										{#each data.trips as t (t.id)}
											<option value={t.id} selected={p.tripId === t.id}>{t.name}</option>
										{/each}
									</select>
								</div>
								<div class="field">
									<label class="label" for={`startDate-${p.id}`}>Start date</label>
									<input id={`startDate-${p.id}`} name="startDate" type="date" value={p.startDate ?? ''} class="input" />
								</div>
								<div class="field">
									<label class="label" for={`endDate-${p.id}`}>End date</label>
									<input id={`endDate-${p.id}`} name="endDate" type="date" value={p.endDate ?? ''} class="input" />
								</div>
								<div class="field sm:col-span-2">
									<label class="label" for={`notes-${p.id}`}>Notes</label>
									<input id={`notes-${p.id}`} name="notes" value={p.notes ?? ''} class="input" />
								</div>
							</div>
							<div class="mt-3 flex gap-2">
								<button type="button" class="btn btn-ghost" onclick={() => (editingId = null)}>Cancel</button>
								<button class="btn btn-primary">Update</button>
							</div>
						</form>
					{:else}
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate font-semibold text-white">{p.provider}</span>
								{#if p.tripId != null}<span class="badge badge-brand">{tripName[p.tripId] ?? `Trip ${p.tripId}`}</span>{/if}
							</div>
							{#if p.coverageSummary}<div class="mt-1 text-sm text-slate-400">{p.coverageSummary}</div>{/if}
							<div class="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
								{#if p.policyNumber}<span class="font-mono text-slate-400">{p.policyNumber}</span>{/if}
								{#if p.coverageAmount != null}<span>Coverage <span class="font-mono text-slate-300">{p.coverageAmount} {p.currency}</span></span>{/if}
								{#if p.startDate || p.endDate}<span class="font-mono text-slate-400">{p.startDate || '—'} → {p.endDate || '—'}</span>{/if}
							</div>
							{#if p.notes}<div class="mt-0.5 truncate text-xs text-slate-500">{p.notes}</div>{/if}
						</div>
						<div class="flex gap-1">
							<button type="button" class="btn btn-ghost btn-ghost-indigo" onclick={() => (editingId = p.id)}>Edit</button>
							<form method="POST" action="?/delete">
								<input type="hidden" name="id" value={p.id} />
								<ConfirmButton class="btn btn-ghost btn-ghost-danger" message="Delete this insurance policy?">Delete</ConfirmButton>
							</form>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{:else}
	<EmptyState message="No insurance policies yet — add one below.">
		{#snippet icon()}
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" /></svg>
		{/snippet}
	</EmptyState>
{/if}

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Add policy</h2>
	<form method="POST" action="?/add" class="grid gap-4 sm:grid-cols-2">
		<div class="field">
			<label class="label" for="provider">Provider</label>
			<input id="provider" name="provider" placeholder="e.g. Allianz" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="policyNumber">Policy #</label>
			<input id="policyNumber" name="policyNumber" placeholder="Policy number" class="input" />
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="coverageSummary">Coverage summary</label>
			<textarea id="coverageSummary" name="coverageSummary" placeholder="What's covered" class="textarea"></textarea>
		</div>
		<div class="field">
			<label class="label" for="coverageAmount">Coverage (cents)</label>
			<input id="coverageAmount" name="coverageAmount" type="number" placeholder="0" class="input" />
		</div>
		<div class="field">
			<label class="label" for="tripId">Trip</label>
			<select id="tripId" name="tripId" class="select">
				<option value="">No trip</option>
				{#each data.trips as t (t.id)}
					<option value={t.id}>{t.name}</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<label class="label" for="startDate">Start date</label>
			<input id="startDate" name="startDate" type="date" class="input" />
		</div>
		<div class="field">
			<label class="label" for="endDate">End date</label>
			<input id="endDate" name="endDate" type="date" class="input" />
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="notes">Notes</label>
			<input id="notes" name="notes" placeholder="Optional notes" class="input" />
		</div>
		<div class="sm:col-span-2">
			<button class="btn btn-primary">Add policy</button>
		</div>
	</form>
</section>
