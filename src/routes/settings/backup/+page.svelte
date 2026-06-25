<script lang="ts">
	let { form } = $props();
	let confirmed = $state(false);
</script>

<h1 class="page-title">Backup & restore</h1>
<p class="page-subtitle">Download a snapshot of the database or restore from a previous backup.</p>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Download backup</h2>
	<p class="mt-1 text-sm text-slate-400">This creates a point-in-time SQLite backup of the current database.</p>
	<div class="mt-4">
		<a href="/settings/backup" download class="btn btn-primary">Download backup</a>
	</div>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<h2 class="section-title">Restore from backup</h2>
	<p class="mt-1 text-sm text-slate-400">
		Upload a previously downloaded <code>.db</code> or <code>.sqlite3</code> file. The current database will be replaced and the app must be restarted.
	</p>

	{#if form?.error}<p class="notice notice-error mt-4">{form.error}</p>{/if}

	<form method="POST" action="?/restore" enctype="multipart/form-data" class="mt-4 space-y-4">
		<div class="field">
			<label class="label" for="file">Backup file</label>
			<input id="file" name="file" type="file" accept=".db,.sqlite,.sqlite3" class="input" required />
		</div>
		<label class="checkbox-label items-start gap-3">
			<input type="checkbox" bind:checked={confirmed} class="checkbox mt-0.5" />
			<span>I understand this will overwrite the current database and requires a restart.</span>
		</label>
		<button type="submit" class="btn btn-danger" disabled={!confirmed}>Restore backup</button>
	</form>
</section>
