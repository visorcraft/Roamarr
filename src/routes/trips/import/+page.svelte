<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Import trips</h1>
		<p class="page-subtitle">Upload a JSON or CSV file to create trips in bulk.</p>
	</div>
	<a href="/trips" class="btn btn-ghost">Back</a>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form method="POST" enctype="multipart/form-data" use:enhance class="grid gap-4">
		<div class="field">
			<label class="label" for="format">Format</label>
			<select id="format" name="format" class="select">
				<option value="json">JSON</option>
				<option value="csv">CSV</option>
			</select>
		</div>
		<div class="field">
			<label class="label" for="file">File</label>
			<input id="file" name="file" type="file" accept=".json,.csv" class="input" required />
		</div>
		<div class="flex flex-wrap gap-2">
			<button type="submit" name="dryRun" value="true" class="btn btn-primary">Preview</button>
			<button type="submit" name="dryRun" value="false" class="btn btn-primary">Import</button>
		</div>
	</form>

	{#if form?.error}
		<div class="notice notice-error mt-4">
			{form.error}
		</div>
	{/if}

	{#if form?.success && form?.result}
		<div class="notice mt-4 {form.dryRun ? 'notice-info' : 'notice-success'}">
			<p>
				{form.dryRun ? 'Would import' : 'Imported'} {form.result.imported} trip{form.result.imported === 1 ? '' : 's'} with
				{form.result.segmentCount} segment{form.result.segmentCount === 1 ? '' : 's'}.
			</p>
			{#if form.result.preview?.length}
				<ul class="mt-3 list-inside list-disc text-sm">
					{#each form.result.preview as p}
						<li>
							<strong>{p.name}</strong>{#if p.startDate} ({p.startDate}){/if}
							{#if p.segments.length} — {p.segments.length} segment{p.segments.length === 1 ? '' : 's'}{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if form.result.errors.length}
				<p class="mt-2 font-semibold">{form.result.errors.length} row(s) had errors:</p>
				<ul class="mt-1 list-inside list-disc text-sm">
					{#each form.result.errors as e}
						<li>Row {e.row}, field {e.field}: {e.message}</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</section>
