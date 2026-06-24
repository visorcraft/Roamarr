<script lang="ts">
	let { data } = $props();
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-extrabold text-white">Loyalty programs</h1>
		<p class="mt-1 text-sm text-muted">
			{data.programs.length} program{data.programs.length === 1 ? '' : 's'} tracked
		</p>
	</div>
</header>

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Your programs</h2>
	{#if data.programs.length}
		<ul class="space-y-2">
			{#each data.programs as p (p.id)}
				<li class="flex items-start gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
					<span class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4.5 w-4.5"><path d="M12 2 15 8.5 22 9.3l-5 4.6L18.5 21 12 17.3 5.5 21 7 13.9l-5-4.6L9 8.5Z" /></svg>
					</span>
					<div class="min-w-0 flex-1">
						<div class="truncate font-semibold text-white">{p.programName}</div>
						<div class="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
							<span class="font-mono text-slate-400">{p.membershipNumber || '—'}</span>
							{#if p.balance != null}<span>Balance <span class="font-mono text-slate-300">{p.balance.toLocaleString()}</span></span>{/if}
						</div>
						{#if p.notes}<div class="mt-0.5 truncate text-xs text-slate-500">{p.notes}</div>{/if}
					</div>
					<form method="POST" action="?/delete">
						<input type="hidden" name="id" value={p.id} />
						<button class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-red-500/10 hover:text-red-300">Delete</button>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="py-6 text-center text-sm text-slate-500">No loyalty programs yet. Add one below.</p>
	{/if}
</section>

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
