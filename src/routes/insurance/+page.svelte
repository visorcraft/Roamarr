<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();
	let editingId = $state<number | null>(null);

	const tripName: Record<number, string> = $derived(
		Object.fromEntries(data.trips.map((t) => [t.id, t.name]))
	);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Insurance policies</h1>
		<p class="page-subtitle">
			{data.policies.length} polic{data.policies.length === 1 ? 'y' : 'ies'} on file
		</p>
	</div>
</header>

{#if data.policies.length}
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Your policies</h2>
		<ul class="list-stack">
			{#each data.policies as p (p.id)}
				<li class="list-item flex items-start gap-3">
					<span class="list-icon">
						<Icon name="insurance" class="h-4.5 w-4.5" />
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
								<span class="list-title">{p.provider}</span>
								{#if p.tripId != null}<span class="badge badge-brand">{tripName[p.tripId] ?? `Trip ${p.tripId}`}</span>{/if}
							</div>
							{#if p.coverageSummary}<div class="mt-1 text-sm text-slate-400">{p.coverageSummary}</div>{/if}
							<div class="meta mt-1 flex flex-wrap items-center gap-x-3">
								{#if p.policyNumber}<span class="meta-strong">{p.policyNumber}</span>{/if}
								{#if p.coverageAmount != null}<span>Coverage <span class="font-mono text-slate-300">{p.coverageAmount} {p.currency}</span></span>{/if}
								{#if p.startDate || p.endDate}<span class="meta-strong">{p.startDate || '—'} → {p.endDate || '—'}</span>{/if}
							</div>
							{#if p.notes}<div class="meta mt-0.5 truncate">{p.notes}</div>{/if}
						</div>
						<div class="flex gap-1">
							<button type="button" class="btn btn-ghost btn-ghost-indigo" onclick={() => (editingId = p.id)}>Edit</button>
							<form method="POST" action="?/delete">
								<input type="hidden" name="id" value={p.id} />
								<ConfirmButton class="btn btn-danger" message="Delete this insurance policy?">Delete</ConfirmButton>
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
			<Icon name="insurance" class="h-6 w-6" />
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
