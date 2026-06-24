<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';

	let { data } = $props();

	let editingId = $state<number | null>(null);

	const typeLabel: Record<string, string> = {
		passport: 'Passport',
		drivers_license: "Driver's license",
		global_entry: 'Global Entry'
	};
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-extrabold text-white">Travel documents</h1>
		<p class="mt-1 text-sm text-muted">
			{data.documents.length} document{data.documents.length === 1 ? '' : 's'} on file
		</p>
	</div>
</header>

{#if data.documents.length}
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Your documents</h2>
		<ul class="space-y-2">
			{#each data.documents as d (d.id)}
				<li class="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
					{#if editingId === d.id}
						<form method="POST" action="?/update" class="grid gap-3 sm:grid-cols-2">
							<input type="hidden" name="id" value={d.id} />
							<div class="field">
								<label class="label" for="type-{d.id}">Type</label>
								<select id="type-{d.id}" name="type" class="select" value={d.type}>
									<option value="passport">Passport</option>
									<option value="drivers_license">Driver's license</option>
									<option value="global_entry">Global Entry</option>
								</select>
							</div>
							<div class="field">
								<label class="label" for="number-{d.id}">Number</label>
								<input id="number-{d.id}" name="number" value={d.number ?? ''} placeholder="Document number" class="input" />
							</div>
							<div class="field">
								<label class="label" for="issuingAuthority-{d.id}">Issuing authority</label>
								<input id="issuingAuthority-{d.id}" name="issuingAuthority" value={d.issuingAuthority ?? ''} placeholder="e.g. U.S. Department of State" class="input" />
							</div>
							<div class="field">
								<label class="label" for="expiresOn-{d.id}">Expires on</label>
								<input id="expiresOn-{d.id}" name="expiresOn" type="date" value={d.expiresOn ?? ''} class="input" />
							</div>
							<div class="field sm:col-span-2">
								<label class="label" for="notes-{d.id}">Notes</label>
								<input id="notes-{d.id}" name="notes" value={d.notes ?? ''} placeholder="Optional notes" class="input" />
							</div>
							<div class="flex items-center gap-2 sm:col-span-2">
								<button class="btn btn-primary">Save</button>
								<button type="button" class="btn" onclick={() => (editingId = null)}>Cancel</button>
							</div>
						</form>
					{:else}
						<div class="flex items-start gap-3">
							<span class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4.5 w-4.5"><path d="M5 22h14a2 2 0 0 0 2-2V7l-5-5H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
							</span>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="badge badge-slate">{typeLabel[d.type] ?? d.type}</span>
									{#if d.issuingAuthority}<span class="truncate text-sm text-slate-400">{d.issuingAuthority}</span>{/if}
								</div>
								<div class="mt-1 font-mono text-xs text-slate-300">{d.number ?? '—'}</div>
								<div class="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
									{#if d.expiresOn}<span>Expires <span class="font-mono text-slate-400">{d.expiresOn}</span></span>{/if}
									{#if d.notes}<span class="truncate">{d.notes}</span>{/if}
								</div>
							</div>
							<div class="flex gap-1">
								<button type="button" class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200" onclick={() => (editingId = d.id)}>Edit</button>
								<form method="POST" action="?/delete">
									<input type="hidden" name="id" value={d.id} />
									<ConfirmButton class="rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-red-500/10 hover:text-red-300" message="Delete this travel document?">Delete</ConfirmButton>
								</form>
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{:else}
	<EmptyState message="No documents yet — add one below.">
		{#snippet icon()}
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><path d="M5 22h14a2 2 0 0 0 2-2V7l-5-5H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
		{/snippet}
	</EmptyState>
{/if}

<section class="card mt-6 p-5">
	<h2 class="section-title mb-3">Add document</h2>
	<form method="POST" action="?/add" class="grid gap-4 sm:grid-cols-2">
		<div class="field">
			<label class="label" for="type">Type</label>
			<select id="type" name="type" class="select">
				<option value="passport">Passport</option>
				<option value="drivers_license">Driver's license</option>
				<option value="global_entry">Global Entry</option>
			</select>
		</div>
		<div class="field">
			<label class="label" for="number">Number</label>
			<input id="number" name="number" placeholder="Document number" class="input" />
		</div>
		<div class="field">
			<label class="label" for="issuingAuthority">Issuing authority</label>
			<input id="issuingAuthority" name="issuingAuthority" placeholder="e.g. U.S. Department of State" class="input" />
		</div>
		<div class="field">
			<label class="label" for="expiresOn">Expires on</label>
			<input id="expiresOn" name="expiresOn" type="date" class="input" />
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="notes">Notes</label>
			<input id="notes" name="notes" placeholder="Optional notes" class="input" />
		</div>
		<div class="sm:col-span-2">
			<button class="btn btn-primary">Add document</button>
		</div>
	</form>
</section>
