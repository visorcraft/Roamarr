<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	const tabs = [
		{ id: 'application', label: 'Application' },
		{ id: 'instance', label: 'Instance' },
		{ id: 'licenses', label: 'Licenses' }
	] as const;
</script>

<header>
	<h1 class="page-title">About {data.app.name}</h1>
	<p class="page-subtitle">Application details and instance metadata.</p>
</header>

<section class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
	<div class="metric-card">
		<p class="metric-label">Application</p>
		<p class="metric-value">{data.app.name}</p>
	</div>
	<div class="metric-card">
		<p class="metric-label">Version</p>
		<p class="metric-value">{data.app.version}</p>
	</div>
	{#if data.stats}
		<div class="metric-card">
			<p class="metric-label">Trips</p>
			<p class="metric-value">{data.stats.trips}</p>
		</div>
		<div class="metric-card">
			<p class="metric-label">Segments</p>
			<p class="metric-value">{data.stats.segments}</p>
		</div>
	{/if}
</section>

<div class="tab-list visited-tab-list mt-6">
	{#each tabs as t (t.id)}
		<a href="/about?tab={t.id}" class="tab-link {data.tab === t.id ? 'tab-link-active' : ''}">{t.label}</a>
	{/each}
</div>

{#if data.tab === 'application'}
	<section class="card mt-6 p-5 sm:p-6">
		<h2 class="section-title">Application</h2>
		<div class="settings-rows">
			<div class="settings-row">
				<div>
					<p class="label">Name</p>
					<p class="field-help">The application name from package metadata.</p>
				</div>
				<p class="font-semibold">{data.app.name}</p>
			</div>
			<div class="settings-row">
				<div>
					<p class="label">Installed version</p>
					<p class="field-help">The version currently running on this instance.</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<span class="code-chip">{data.app.version}</span>
					<span class="badge badge-brand">Current install</span>
				</div>
			</div>
			<div class="settings-row">
				<div>
					<p class="label">Instance name</p>
					<p class="field-help">The display name configured for this server.</p>
				</div>
				<p class="font-semibold">{data.instanceName}</p>
			</div>
			<div class="settings-row">
				<div>
					<p class="label">Runtime environment</p>
					<p class="field-help">Node environment reported by the running process.</p>
				</div>
				<span class="code-chip">{data.environment}</span>
			</div>
		</div>
	</section>
{/if}

{#if data.tab === 'instance'}
	{#if data.stats}
		<section class="card mt-6 p-5 sm:p-6">
			<h2 class="section-title">Instance</h2>
			<div class="settings-rows">
				<div class="settings-row">
					<div>
						<p class="label">Users</p>
						<p class="field-help">Total user accounts.</p>
					</div>
					<p class="font-semibold">{data.stats.users}</p>
				</div>
				<div class="settings-row">
					<div>
						<p class="label">Groups</p>
						<p class="field-help">Total sharing groups.</p>
					</div>
					<p class="font-semibold">{data.stats.groups}</p>
				</div>
				<div class="settings-row">
					<div>
						<p class="label">Notifications</p>
						<p class="field-help">Stored in-app notifications.</p>
					</div>
					<p class="font-semibold">{data.stats.notifications}</p>
				</div>
				<div class="settings-row">
					<div>
						<p class="label">Database path</p>
						<p class="field-help">MongrelDB Kit data path used by the server.</p>
					</div>
					<span class="code-chip">{data.databasePath}</span>
				</div>
				{#if data.mongrel}
					<div class="settings-row">
						<div>
							<p class="label">MongrelDB engine</p>
							<p class="field-help">Installed package and native engine version for this process.</p>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<span class="code-chip">{data.mongrel.enginePackageVersion ?? 'unknown'}</span>
							<span class="code-chip">engine {data.mongrel.engineVersion}</span>
						</div>
					</div>
					<div class="settings-row">
						<div>
							<p class="label">MongrelDB Kit</p>
							<p class="field-help">Installed schema/query-builder package version.</p>
						</div>
						<span class="code-chip">{data.mongrel.kitPackageVersion ?? 'unknown'}</span>
					</div>
					<div class="settings-row">
						<div>
							<p class="label">Engine build</p>
							<p class="field-help">Native artifact version and source git SHA.</p>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<span class="code-chip">{data.mongrel.artifactVersion}</span>
							<span class="code-chip font-mono text-xs">{data.mongrel.gitSha.slice(0, 12)}</span>
						</div>
					</div>
				{/if}
			</div>
		</section>
	{:else}
		<section class="card mt-6 p-5 sm:p-6">
			<p class="empty-text">Instance details are only available to administrators.</p>
		</section>
	{/if}
{/if}

{#if data.tab === 'licenses'}
	<section class="card mt-6 p-5 sm:p-6">
		<h2 class="section-title">Licenses & Credits</h2>
		<p class="page-subtitle">
			Bundled attribution records for Roamarr, third-party npm packages, acknowledgements, and
			runtime components.
		</p>
		<div class="mt-5 grid gap-3 sm:grid-cols-2">
			<a class="choice-card" href="/about/licenses">
				<span class="choice-icon">
					<Icon name="document" class="h-5 w-5" />
				</span>
				<span class="min-w-0 flex-1">
					<span class="choice-title block">Licenses</span>
					<span class="row-subtitle">Project, third-party, acknowledgements, and runtime text.</span>
				</span>
				<Icon name="arrow-right" class="h-4 w-4" />
			</a>
			<a class="choice-card" href="/about/credits">
				<span class="choice-icon">
					<Icon name="info" class="h-5 w-5" />
				</span>
				<span class="min-w-0 flex-1">
					<span class="choice-title block">Credits</span>
					<span class="row-subtitle">Filterable package and runtime component attribution table.</span>
				</span>
				<Icon name="arrow-right" class="h-4 w-4" />
			</a>
		</div>
	</section>
{/if}
