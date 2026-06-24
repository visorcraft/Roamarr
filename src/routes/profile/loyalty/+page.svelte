<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';

	let { data } = $props();
	let editingId = $state<number | null>(null);
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-extrabold text-white">Loyalty programs</h1>
		<p class="mt-1 text-sm text-muted">
			{data.programs.length} program{data.programs.length === 1 ? '' : 's'} tracked
		</p>
	</div>
</header>

{#if data.programs.length}
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Your programs</h2>
		<ul class="space-y-2">
			{#each data.programs as p (p.id)}
				<li class="flex items-start gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
					<span class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4.5 w-4.5"><path d="M12 2 15 8.5 22 9.3l-5 4.6L18.5 21 12 17.3 5.5 21 7 13.9l-5-4.6L9 8.5Z" /></svg>
					</span>
					{#if editingId === p.id}
						<form method="POST" action="?/update" class="min-w-0 flex-1">
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
								<button class="btn btn-primary btn-sm">Update</button>
								<button type="button" class="btn btn-ghost btn-sm" onclick={() => (editingId = null)}>Cancel</button>
							</div>
						</form>
					{:else}
						<div class="min-w-0 flex-1">
							<div class="truncate font-semibold text-white">{p.programName}</div>
							<div class="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
								<span class="font-mono text-slate-400">{p.membershipNumber || '—'}</span>
								{#if p.balance != null}<span>Balance <span class="font-mono text-slate-300">{p.balance.toLocaleString()}</span></span>{/if}
							</div>
							{#if p.notes}<div class="mt-0.5 truncate text-xs text-slate-500">{p.notes}</div>{/if}
						</div>
						<div class="flex gap-1">
							<button type="button" class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-indigo-500/10 hover:text-indigo-300" onclick={() => (editingId = p.id)}>Edit</button>
							<form method="POST" action="?/delete">
								<input type="hidden" name="id" value={p.id} />
								<ConfirmButton class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-red-500/10 hover:text-red-300" message="Delete this loyalty program?">Delete</ConfirmButton>
							</form>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{:else}
	<EmptyState message="No loyalty programs yet — add one below.">
		{#snippet icon()}
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><path d="M12 2 15 8.5 22 9.3l-5 4.6L18.5 21 12 17.3 5.5 21 7 13.9l-5-4.6L9 8.5Z" /></svg>
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
