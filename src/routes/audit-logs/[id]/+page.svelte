<script lang="ts">
	import { goto } from '$app/navigation';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';

	let { data } = $props();
	const { formatDateTime } = useDateFormat();

	const log = $derived(data.log);
	const entityUrl = $derived(data.entityUrl);

	function metaEntries(meta: Record<string, unknown>): Array<{ key: string; value: unknown }> {
		return Object.entries(meta).map(([key, value]) => ({ key, value }));
	}

	function formatValue(value: unknown): string {
		if (value === null) return 'null';
		if (value === undefined) return 'undefined';
		if (typeof value === 'string') return value;
		if (typeof value === 'boolean' || typeof value === 'number') return String(value);
		return JSON.stringify(value, null, 2);
	}
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Audit log entry</h1>
		<p class="page-subtitle">
			{log.action} · {log.entityType}#{log.entityId} · {formatDateTime(log.createdAt)}
		</p>
	</div>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<div class="settings-rows">
		<div class="settings-row">
			<p class="label">User</p>
			<div>
				<p class="font-semibold">{log.user.displayName || log.user.email}</p>
				{#if log.user.displayName && log.user.email}
					<p class="meta">{log.user.email}</p>
				{/if}
			</div>
		</div>

		<div class="settings-row">
			<p class="label">Entity</p>
			<div class="flex items-center gap-2">
				<span class="font-semibold font-mono">{log.entityType}:{log.entityId}</span>
				{#if entityUrl}
					<a href={entityUrl} class="link text-sm">View</a>
				{/if}
			</div>
		</div>
	</div>

	<h2 class="section-title mt-6 mb-4">Details</h2>
	{#if Object.keys(log.meta).length === 0}
		<p class="empty-text">No additional details.</p>
	{:else}
		<div class="settings-rows">
			{#each metaEntries(log.meta) as { key, value } (key)}
				<div class="settings-row">
					<p class="label">{key}</p>
					<pre class="meta-strong whitespace-pre-wrap">{formatValue(value)}</pre>
				</div>
			{/each}
		</div>
	{/if}

	<div class="mt-6 flex flex-wrap justify-end gap-2">
		<button class="btn btn-ghost" type="button" onclick={() => goto('/audit-logs')}>
			Back to audit log
		</button>
	</div>
</section>
