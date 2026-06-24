<script lang="ts">
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';

	let { data, form }: { data: import('./$types').PageData; form?: { testResult?: string } } = $props();
	let editingId = $state<number | null>(null);

	const providerLabel = $derived(
		new Map(data.providers.map((p) => [p.key, p.label]))
	);
</script>

<header>
	<h1 class="text-3xl font-extrabold text-white">Fare-watch providers</h1>
	<p class="mt-1 text-sm text-muted">Connect named provider accounts to power fare watching on your trips.</p>
</header>

<section class="card mt-8 p-5 sm:p-6">
	<h2 class="section-title">Your accounts</h2>
	{#if form?.testResult}<p class="notice notice-info mt-3 text-sm">{form.testResult}</p>{/if}
	{#if data.saved.length}
		<div class="mt-3 space-y-3">
			{#each data.saved as s (s.id)}
				<div class="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<span class="truncate font-semibold text-white">{s.label || providerLabel.get(s.providerKey) || s.providerKey}</span>
								<span class="badge badge-slate">{providerLabel.get(s.providerKey) || s.providerKey}</span>
								{#if s.enabled}
									<span class="badge badge-green">Enabled</span>
								{:else}
									<span class="badge badge-slate">Disabled</span>
								{/if}
							</div>
						</div>
						<div class="flex gap-1">
								<button type="button" class="btn btn-ghost btn-ghost-indigo" onclick={() => editingId = s.id}>Edit</button>
								<form method="POST" action="?/test">
									<input type="hidden" name="id" value={s.id} />
									<button class="btn btn-ghost">Test</button>
								</form>
								<form method="POST" action="?/delete">
									<input type="hidden" name="id" value={s.id} />
									<ConfirmButton class="btn btn-ghost btn-ghost-danger" message="Delete this provider account and its watches?">Delete</ConfirmButton>
								</form>
							</div>
					</div>
					{#if editingId === s.id}
						<form method="POST" action="?/update" class="mt-4 grid gap-4 border-t border-white/5 pt-4 sm:grid-cols-2">
							<input type="hidden" name="id" value={s.id} />
							<div class="field">
								<label class="label" for={`label-${s.id}`}>Label</label>
								<input id={`label-${s.id}`} name="label" value={s.label} class="input" placeholder="e.g. Personal API key" />
							</div>
							<div class="field flex items-end">
								<label class="flex items-center gap-2 text-sm text-slate-300">
									<input
										type="checkbox"
										name="enabled"
										checked={s.enabled}
										class="h-4 w-4 rounded border-white/20 bg-white/5 text-indigo-500 accent-indigo-500"
									/>
									Enabled
								</label>
							</div>
							<div class="field sm:col-span-2">
								<label class="label" for={`apiKey-${s.id}`}>API key</label>
								<input
									id={`apiKey-${s.id}`}
									name="apiKey"
									placeholder={s.hasKey ? 'API key set — leave blank to keep' : 'API key'}
									class="input"
								/>
							</div>
							<div class="flex gap-2 sm:col-span-2">
								<button type="button" class="btn btn-ghost" onclick={() => editingId = null}>Cancel</button>
								<button class="btn btn-primary">Save</button>
							</div>
						</form>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="mt-3 py-6 text-center text-sm text-slate-500">No provider accounts saved yet.</p>
	{/if}
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Add account</h2>
	<form method="POST" action="?/add" class="mt-3 grid gap-4 sm:grid-cols-2">
		<div class="field">
			<label class="label" for="providerKey">Provider</label>
			<select id="providerKey" name="providerKey" class="select">
				{#each data.providers as p (p.key)}
					<option value={p.key}>{p.label}</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<label class="label" for="label">Label</label>
			<input id="label" name="label" placeholder="e.g. Personal API key" class="input" />
		</div>
		<div class="field sm:col-span-2">
			<label class="label" for="apiKey">API key</label>
			<input id="apiKey" name="apiKey" placeholder="API key" class="input" />
		</div>
		<div class="field flex items-end">
			<label class="flex items-center gap-2 text-sm text-slate-300">
				<input
					type="checkbox"
					name="enabled"
					checked
					class="h-4 w-4 rounded border-white/20 bg-white/5 text-indigo-500 accent-indigo-500"
				/>
				Enabled
			</label>
		</div>
		<div class="flex items-end">
			<button class="btn btn-primary">Add account</button>
		</div>
	</form>
</section>
