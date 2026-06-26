<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();
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
					<p class="field-help">SQLite database path used by the server.</p>
				</div>
				<span class="code-chip">{data.databasePath}</span>
			</div>
		</div>
	</section>
{/if}

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Licenses & Credits</h2>
	<p class="page-subtitle">
		Bundled attribution records for Roamarr, third-party npm packages, acknowledgements, and
		runtime components.
	</p>
	<div class="mt-5 grid gap-3 sm:grid-cols-2">
		<a class="choice-card" href="/settings/about/licenses">
			<span class="choice-icon">
				<Icon name="document" class="h-5 w-5" />
			</span>
			<span class="min-w-0 flex-1">
				<span class="choice-title block">Licenses</span>
				<span class="row-subtitle">Project, third-party, acknowledgements, and runtime text.</span>
			</span>
			<Icon name="arrow-right" class="h-4 w-4" />
		</a>
		<a class="choice-card" href="/settings/about/credits">
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
