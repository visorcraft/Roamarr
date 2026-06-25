<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data, form } = $props();

	let editingId = $state<number | null>(null);

	const typeLabel: Record<string, string> = {
		passport: 'Passport',
		drivers_license: "Driver's license",
		global_entry: 'Global Entry',
		visa: 'Visa'
	};

	const companionNameById = $derived(
		new Map(data.companions.map((c) => [c.id, c.name]))
	);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Travel documents</h1>
		<p class="page-subtitle">
			{data.documents.length} document{data.documents.length === 1 ? '' : 's'} on file
		</p>
	</div>
</header>

{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

{#if data.documents.length}
	<section class="card mt-6 p-5">
		<h2 class="section-title mb-3">Your documents</h2>
		<ul class="list-stack">
			{#each data.documents as d (d.id)}
				<li class="list-item">
					{#if editingId === d.id}
						<form method="POST" action="?/update" class="grid gap-3 sm:grid-cols-2">
							<input type="hidden" name="id" value={d.id} />
							<div class="field">
								<label class="label" for="type-{d.id}">Type</label>
								<select id="type-{d.id}" name="type" class="select" value={d.type}>
									<option value="passport">Passport</option>
									<option value="drivers_license">Driver's license</option>
									<option value="global_entry">Global Entry</option>
									<option value="visa">Visa</option>
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
							<div class="field">
								<label class="label" for="companionId-{d.id}">Companion</label>
								<select id="companionId-{d.id}" name="companionId" class="select" value={d.companionId ?? ''}>
									<option value="">Me (owner)</option>
									{#each data.companions as c (c.id)}
										<option value={c.id}>{c.name}</option>
									{/each}
								</select>
							</div>
							<div class="field sm:col-span-2">
								<label class="label" for="notes-{d.id}">Notes</label>
								<input id="notes-{d.id}" name="notes" value={d.notes ?? ''} placeholder="Optional notes" class="input" />
							</div>
							<div class="flex items-center gap-2 sm:col-span-2">
								<button type="button" class="btn btn-ghost" onclick={() => (editingId = null)}>Cancel</button>
								<button class="btn btn-primary">Save</button>
							</div>
						</form>
					{:else}
						<div class="flex items-start gap-3">
							<span class="list-icon">
								<Icon name="document" class="h-4.5 w-4.5" />
							</span>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="badge badge-slate">{typeLabel[d.type] ?? d.type}</span>
									{#if d.issuingAuthority}<span class="truncate text-sm text-slate-400">{d.issuingAuthority}</span>{/if}
								</div>
								<div class="mt-1 font-mono text-xs text-slate-300">{d.number ?? '—'}</div>
								<div class="meta mt-0.5 flex flex-wrap items-center gap-x-3">
									{#if d.companionId}
										<span class="meta-strong">{companionNameById.get(d.companionId) ?? 'Companion'}</span>
									{:else}
										<span>Me</span>
									{/if}
									{#if d.expiresOn}<span>Expires <span class="meta-strong">{d.expiresOn}</span></span>{/if}
									{#if d.notes}<span class="truncate">{d.notes}</span>{/if}
								</div>
							</div>
							<div class="flex gap-1">
								<button type="button" class="btn btn-ghost btn-ghost-muted" onclick={() => (editingId = d.id)}>Edit</button>
								<form method="POST" action="?/delete">
									<input type="hidden" name="id" value={d.id} />
									<ConfirmButton class="btn btn-ghost btn-ghost-danger" message="Delete this travel document?">Delete</ConfirmButton>
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
			<Icon name="document" class="h-6 w-6" />
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
				<option value="visa">Visa</option>
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
		<div class="field">
			<label class="label" for="companionId">Companion</label>
			<select id="companionId" name="companionId" class="select">
				<option value="">Me (owner)</option>
				{#each data.companions as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
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
