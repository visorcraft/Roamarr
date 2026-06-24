<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-3xl font-extrabold text-white">Import trips</h1>
		<p class="mt-1 text-sm text-muted">Upload a JSON or CSV file to create trips in bulk.</p>
	</div>
	<a href="/trips" class="btn btn-ghost btn-sm">Back</a>
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
		<div>
			<button class="btn btn-primary">Import</button>
		</div>
	</form>

	{#if form?.error}
		<div class="mt-4 rounded-lg bg-red-500/10 p-4 text-red-200 ring-1 ring-red-400/20">
			{form.error}
		</div>
	{/if}

	{#if form?.success && form?.result}
		<div class="mt-4 rounded-lg bg-green-500/10 p-4 text-green-200 ring-1 ring-green-400/20">
			<p>
				Imported {form.result.imported} trip{form.result.imported === 1 ? '' : 's'} with
				{form.result.segmentCount} segment{form.result.segmentCount === 1 ? '' : 's'}.
			</p>
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
