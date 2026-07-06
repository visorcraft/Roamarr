<script lang="ts">
	import CancelButton from '$lib/components/CancelButton.svelte';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();
	let editingId = $state<number | null>(null);
	let dirtyIds = $state<Record<number, boolean>>({});
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Loyalty programs</h1>
		<p class="page-subtitle">
			{data.programs.length} program{data.programs.length === 1 ? '' : 's'} tracked
		</p>
	</div>
</header>

{#if data.programs.length}
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Your programs</h2>
		<ul class="list-stack">
			{#each data.programs as p (p.id)}
				<li class="list-item">
					{#if editingId === p.id}
						<form method="POST" action="?/update" class="min-w-0" oninput={() => (dirtyIds[p.id] = true)}>
							<input type="hidden" name="id" value={p.id} />
							<div class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
								<div class="field">
									<label class="label" for={`programName-${p.id}`}>Program</label>
									<input id={`programName-${p.id}`} name="programName" value={p.programName} class="input" required />
								</div>
								<div class="field">
									<label class="label" for={`membershipNumber-${p.id}`}>Membership #</label>
									<input id={`membershipNumber-${p.id}`} name="membershipNumber" value={p.membershipNumber ?? ''} class="input" />
								</div>
								<div class="field">
									<label class="label" for={`balance-${p.id}`}>Balance</label>
									<input id={`balance-${p.id}`} name="balance" type="number" value={p.balance ?? ''} class="input" />
								</div>
							</div>
							<div class="field mt-3">
								<label class="label" for={`notes-${p.id}`}>Notes</label>
								<input id={`notes-${p.id}`} name="notes" value={p.notes ?? ''} class="input" />
							</div>
							<div class="mt-3 flex gap-2">
								<CancelButton dirty={dirtyIds[p.id] ?? false} onConfirm={() => (editingId = null)}>Cancel</CancelButton>
								<button class="btn btn-primary">Update</button>
							</div>
						</form>
					{:else}
						<div class="flex items-start justify-between gap-3">
							<div class="flex items-start gap-3 min-w-0 flex-1">
								<span class="list-icon">
									<Icon name="star" class="h-4.5 w-4.5" />
								</span>
								<div class="min-w-0 flex-1">
									<div class="list-title">{p.programName}</div>
									<div class="meta mt-1 flex flex-wrap items-center gap-x-3">
										<span class="meta-strong">{p.membershipNumber || '—'}</span>
										{#if p.balance != null}<span>Balance <span class="font-mono text-slate-300">{p.balance.toLocaleString()}</span></span>{/if}
									</div>
									{#if p.notes}<div class="meta mt-0.5 truncate">{p.notes}</div>{/if}
								</div>
							</div>
							<div class="action-row gap-1">
								<button type="button" class="btn btn-primary" onclick={() => { editingId = p.id; dirtyIds[p.id] = false; }}>Edit</button>
								<form method="POST" action="?/delete">
									<input type="hidden" name="id" value={p.id} />
									<ConfirmButton class="btn btn-danger" message="Delete this loyalty program?">Delete</ConfirmButton>
								</form>
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{:else}
	<EmptyState message="No loyalty programs yet — add one below.">
		{#snippet icon()}
			<Icon name="star" class="h-6 w-6" />
		{/snippet}
	</EmptyState>
{/if}

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Add program</h2>
	<form method="POST" action="?/add" class="grid gap-4 sm:grid-cols-2">
		<div class="field">
			<label class="label" for="programName">Program</label>
			<input id="programName" name="programName" placeholder="e.g. United MileagePlus" class="input" required />
		</div>
		<div class="field">
			<label class="label" for="membershipNumber">Membership #</label>
			<input id="membershipNumber" name="membershipNumber" placeholder="Membership number" class="input" />
		</div>
		<div class="field">
			<label class="label" for="balance">Balance</label>
			<input id="balance" name="balance" type="number" placeholder="0" class="input" />
		</div>
		<div class="field">
			<label class="label" for="notes">Notes</label>
			<input id="notes" name="notes" placeholder="Optional notes" class="input" />
		</div>
		<div class="sm:col-span-2">
			<button class="btn btn-primary">Add program</button>
		</div>
	</form>
</section>
