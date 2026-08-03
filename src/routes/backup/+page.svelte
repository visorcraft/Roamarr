<script lang="ts">
	let { data, form } = $props();
	let confirmed = $state(false);
</script>

<h1 class="page-title">Backup & Restore</h1>
<p class="page-subtitle">Download a snapshot of the database or restore from a previous backup.</p>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Download backup</h2>
	<p class="mt-1 text-sm text-slate-400">
		Point-in-time archive of the MongrelDB database directory and attachments.
		The GeoNames city catalog is omitted (re-import under Database settings if needed).
		Maps under <code>/data/maps</code> are not included. Size is dominated by the
		engine write-ahead log (WAL), not trip row count — run <strong>Flush</strong> then
		<strong>Garbage collect</strong> on Database Maintenance to reclaim old WAL segments
		before downloading if the file is large.
	</p>
	<div class="mt-4">
		<a href="/backup" download class="btn btn-primary">Download backup</a>
	</div>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Automatic backups</h2>
	<p class="mt-1 text-sm text-slate-400">
		When enabled, the scheduler writes <code>auto-*.mongreldb.tar.gz</code> archives to
		<code>{data.autoBackup.directory}</code> on the configured interval and keeps the newest
		archives up to the retention count. Files without the <code>auto-</code> prefix are never
		pruned.
	</p>
	<p class="mt-2 text-sm text-slate-400">
		Status:
		{#if data.autoBackup.enabled}
			enabled — {data.autoBackup.storedCount} stored,
			last run {data.autoBackup.lastRunAt ?? 'never'},
			next due {data.autoBackup.nextDueAt ?? 'on the next scheduler tick'}.
		{:else}
			disabled.
		{/if}
	</p>

	<form method="POST" action="?/saveAutoBackup" class="mt-4 grid gap-4 sm:grid-cols-2">
		<div class="field">
			<label class="label" for="backupIntervalHours">Interval (hours)</label>
			<input
				id="backupIntervalHours"
				name="backupIntervalHours"
				type="number"
				min="1"
				max="720"
				step="1"
				value={data.autoBackup.intervalHours}
				class="input"
				required
			/>
		</div>
		<div class="field">
			<label class="label" for="backupRetentionCount">Retention (keep newest)</label>
			<input
				id="backupRetentionCount"
				name="backupRetentionCount"
				type="number"
				min="1"
				max="100"
				step="1"
				value={data.autoBackup.retentionCount}
				class="input"
				required
			/>
		</div>
		<div class="field sm:col-span-2">
			<label class="checkbox-label">
				<input type="checkbox" name="backupAutoEnabled" checked={data.autoBackup.enabled} class="checkbox" />
				Enable automatic backups
			</label>
		</div>
		<div class="flex justify-end sm:col-span-2">
			<button class="btn btn-primary">Save auto-backup settings</button>
		</div>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Restore from backup</h2>
	<p class="mt-1 text-sm text-slate-400">
		Upload a previously downloaded <code>.mongreldb.tar.gz</code> file. The current database directory will be replaced and the app must be restarted.
	</p>

	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

	<form method="POST" action="?/restore" enctype="multipart/form-data" class="mt-4 space-y-4">
		<div class="field">
			<label class="label" for="file">Backup file</label>
			<input id="file" name="file" type="file" accept=".mongreldb.tar.gz,.tar.gz" class="input" required />
		</div>
		<label class="checkbox-label items-start gap-3">
			<input type="checkbox" bind:checked={confirmed} class="checkbox mt-0.5" />
			<span>I understand this will overwrite the current database and requires a restart.</span>
		</label>
		<button type="submit" class="btn btn-danger" disabled={!confirmed}>Restore backup</button>
	</form>
</section>
