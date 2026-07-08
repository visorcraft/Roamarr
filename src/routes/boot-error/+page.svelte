<script lang="ts">
	import { appInfo } from '$lib/appInfo';

	let { data } = $props();
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">{appInfo.name} cannot start</h1>
		<p class="page-subtitle">This instance is configured but failed to boot.</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<p class="text-sm">
		Setup for this {appInfo.name} instance has already been completed, so the
		first-run setup wizard is intentionally disabled. The server encountered a
		problem during boot and cannot serve requests right now.
	</p>

	<div class="mt-4 notice notice-error">
		{#if data.missingSecret}
			<strong>ROAMARR_SECRET is missing or invalid.</strong>
			The encryption secret required to read the existing database is not
			available. Restore the original <code class="code-chip">ROAMARR_SECRET</code>
			environment variable — a different secret cannot decrypt your data.
		{:else if data.bootError}
			<strong>Boot error:</strong>
			<pre class="mt-2 whitespace-pre-wrap font-mono text-xs">{data.bootError}</pre>
		{:else}
			Unknown boot failure.
		{/if}
	</div>

	<h2 class="subsection-title mt-6 mb-2">What to check</h2>
	<ul class="list-disc pl-5 text-sm space-y-1">
		<li>Server logs for the full stack trace.</li>
		<li>If a database migration failed: inspect the failing migration, restore from a backup if needed, then restart.</li>
		<li>If the secret was lost: the data is unrecoverable. A fresh database + new secret + re-running setup is the only path.</li>
		<li>Database file permissions and disk space on the host.</li>
	</ul>
</section>
