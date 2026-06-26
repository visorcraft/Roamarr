<script lang="ts">
	let { data } = $props();

	let filterText = $state('');
	const query = $derived(filterText.trim().toLowerCase());
	const filteredPackages = $derived.by(() => {
		if (!query) return data.packages;
		return data.packages.filter((pkg) =>
			[pkg.name, pkg.version, pkg.license, pkg.scope, pkg.packagePath]
				.join(' ')
				.toLowerCase()
				.includes(query)
		);
	});
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Credits</h1>
		<p class="page-subtitle">
			{data.counts.packages} npm packages - {data.counts.runtimeComponents} runtime components
		</p>
	</div>
	<a class="btn btn-secondary" href="/settings/about/licenses">Licenses</a>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="section-title">Runtime components</h2>
			<p class="page-subtitle">
				Components used by common Roamarr source builds and deployments. Host providers may
				add their own notices.
			</p>
		</div>
		<a class="btn btn-ghost" href="/settings/about/licenses?tab=runtime">Runtime licenses</a>
	</div>

	<div class="mt-5 divide-y" style="border-color: var(--theme-line);">
		{#each data.runtimeComponents as component (component.name)}
			<div class="grid gap-3 py-4 lg:grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,1fr)_auto] lg:items-center">
				<div>
					<p class="font-semibold">{component.name}</p>
					<p class="field-help">{component.usage}</p>
				</div>
				<span class="code-chip">{component.licenses}</span>
				<a class="btn btn-ghost btn-sm justify-center" href={component.url} target="_blank" rel="noreferrer">
					Project
				</a>
			</div>
		{/each}
	</div>
</section>

<section class="mt-6">
	<div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
		<div>
			<p class="label">NPM packages</p>
			<p class="field-help">
				Generated from package-lock.json. Filter by package name, version, scope, or license.
			</p>
		</div>
		<div class="flex items-center gap-3">
			<input
				class="input w-full lg:w-96"
				type="search"
				placeholder="Filter by package name or license..."
				bind:value={filterText}
			/>
			<span class="code-chip whitespace-nowrap">{filteredPackages.length} / {data.packages.length}</span>
		</div>
	</div>

	<div class="card overflow-hidden">
		<div class="overflow-x-auto">
			<table class="table min-w-[52rem]">
				<thead>
					<tr>
						<th>Package</th>
						<th>Version</th>
						<th>Scope</th>
						<th>License expression</th>
						<th>Project</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredPackages as pkg (`${pkg.name}@${pkg.version}:${pkg.packagePath}`)}
						<tr>
							<td class="font-mono">{pkg.name}</td>
							<td class="font-mono">{pkg.version}</td>
							<td>
								<span class="badge {pkg.scope === 'production' ? 'badge-brand' : 'badge-slate'}">
									{pkg.scope}
								</span>
							</td>
							<td><span class="code-chip">{pkg.license}</span></td>
							<td>
								{#if pkg.url}
									<a class="btn btn-ghost btn-sm" href={pkg.url} target="_blank" rel="noreferrer">
										Open
									</a>
								{:else}
									<span class="meta">No URL</span>
								{/if}
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="5" class="text-center">
								<p class="empty-text">No packages match this filter.</p>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</section>
