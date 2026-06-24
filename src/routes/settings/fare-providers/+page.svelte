<script lang="ts">
	let { data } = $props();
	const savedByKey = $derived(new Map(data.saved.map((s) => [s.providerKey, s])));
</script>

<header>
	<h1 class="text-3xl font-extrabold text-white">Fare-watch providers</h1>
	<p class="mt-1 text-sm text-muted">Connect provider API keys to power fare watching on your trips.</p>
</header>

<section class="card mt-8 p-5 sm:p-6">
	<h2 class="section-title">Providers</h2>
	<div class="mt-3 space-y-3">
		{#each data.providers as p (p.key)}
			{@const s = savedByKey.get(p.key)}
			<form
				method="POST"
				action="?/save"
				class="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5"
			>
				<input type="hidden" name="providerKey" value={p.key} />
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex items-center gap-2">
						<span class="font-semibold text-white">{p.label}</span>
						{#if s?.enabled}
							<span class="badge badge-green">Enabled</span>
						{:else}
							<span class="badge badge-slate">Disabled</span>
						{/if}
					</div>
					<label class="flex items-center gap-2 text-sm text-slate-300">
						<input
							type="checkbox"
							name="enabled"
							checked={s?.enabled ?? false}
							class="h-4 w-4 rounded border-white/20 bg-white/5 text-indigo-500 accent-indigo-500"
						/>
						Enabled
					</label>
				</div>
				<div class="mt-3 flex flex-wrap items-end gap-3">
					<div class="field min-w-0 flex-1">
						<label class="label" for={`apiKey-${p.key}`}>API key</label>
						<input
							id={`apiKey-${p.key}`}
							name="apiKey"
							placeholder={s?.hasKey ? 'API key set — leave blank to keep' : 'API key'}
							class="input"
						/>
					</div>
					<button class="btn btn-primary btn-sm">Save</button>
				</div>
			</form>
		{/each}
	</div>
</section>
