<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	type PreviewRow = {
		index: number;
		name: string;
		lat: number | null;
		lng: number | null;
		address?: string | null;
		description?: string | null;
		sourceUrl?: string | null;
		categoryGuess?: string | null;
		duplicate: boolean;
		duplicateReason: string | null;
		warnings: string[];
	};

	const preview = $derived((form?.preview ?? null) as PreviewRow[] | null);
	let skipDuplicates = $state(true);
	let included = $state<Set<number>>(new Set());

	$effect(() => {
		if (preview) {
			included = new Set(
				preview.filter((r) => !r.duplicate || !skipDuplicates).map((r) => r.index)
			);
		}
	});

	function toggleRow(index: number) {
		const next = new Set(included);
		if (next.has(index)) next.delete(index);
		else next.add(index);
		included = next;
	}

	function toggleSkipDuplicates() {
		skipDuplicates = !skipDuplicates;
		// The effect above re-derives `included` from the new flag.
	}

	const selectedRows = $derived(
		preview ? preview.filter((r) => included.has(r.index)) : []
	);

	function rowsJson(): string {
		return JSON.stringify(
			selectedRows.map((r) => ({
				name: r.name,
				lat: r.lat,
				lng: r.lng,
				address: r.address ?? null,
				description: r.description ?? null,
				sourceUrl: r.sourceUrl ?? null,
				categoryGuess: r.categoryGuess ?? null
			}))
		);
	}

	const duplicateCount = $derived(preview ? preview.filter((r) => r.duplicate).length : 0);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Import places</h1>
		<p class="page-subtitle">
			Import saved places from Google Takeout (CSV), KML/KMZ, GeoJSON, or pasted Google Maps links.
		</p>
	</div>
	<a href="/places" class="btn btn-ghost">Back</a>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form method="POST" action="?/preview" enctype="multipart/form-data" class="grid gap-4">
		<div class="field">
			<label class="label" for="file">File</label>
			<input
				id="file"
				name="file"
				type="file"
				accept=".csv,.kml,.kmz,.geojson,.json,.txt"
				class="input"
			/>
			<p class="mt-1 text-sm opacity-60">
				Google Takeout “Saved” CSV, KML/KMZ, or a GeoJSON FeatureCollection. Up to 20 MB and
				10,000 rows.
			</p>
		</div>
		<div class="field">
			<label class="label" for="urlList">…or paste Google Maps links</label>
			<textarea
				id="urlList"
				name="urlList"
				class="input"
				rows="4"
				placeholder="https://www.google.com/maps/place/… (one per line)"
			></textarea>
		</div>
		<div class="flex flex-wrap gap-2">
			<button type="submit" class="btn btn-primary">
				<Icon name="import" class="h-4 w-4" />Preview import
			</button>
		</div>
	</form>

	{#if form?.error}
		<div class="notice notice-error mt-4">{form.error}</div>
	{/if}
</section>

{#if preview}
	<section class="card mt-6 p-5 sm:p-6">
		<h2 class="text-base font-semibold">
			Preview — {preview.length} row{preview.length === 1 ? '' : 's'} from {form?.sourceName}
		</h2>
		<p class="mt-1 text-sm opacity-75">
			{duplicateCount} possible duplicate{duplicateCount === 1 ? '' : 's'} detected
			(exact name or within 50 m of an existing place).
		</p>

		{#if form?.parseWarnings?.length}
			<div class="notice notice-info mt-3">
				<p class="font-semibold">{form.parseWarnings.length} parse warning(s):</p>
				<ul class="mt-1 list-inside list-disc text-sm">
					{#each form.parseWarnings.slice(0, 20) as w}
						<li>{w}</li>
					{/each}
					{#if form.parseWarnings.length > 20}
						<li>…and {form.parseWarnings.length - 20} more</li>
					{/if}
				</ul>
			</div>
		{/if}

		<div class="mt-4 overflow-x-auto">
			<table class="table">
				<thead>
					<tr>
						<th>Include</th>
						<th>Name</th>
						<th>Coordinates</th>
						<th>Notes</th>
					</tr>
				</thead>
				<tbody>
					{#each preview as row (row.index)}
						<tr>
							<td>
								<input
									type="checkbox"
									checked={included.has(row.index)}
									onchange={() => toggleRow(row.index)}
									aria-label={`Include ${row.name}`}
								/>
							</td>
							<td>
								<span class="font-medium">{row.name}</span>
								{#if row.address}<span class="block text-sm opacity-75">{row.address}</span>{/if}
								{#if row.sourceUrl}
									<a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" class="link text-sm">Source link</a>
								{/if}
							</td>
							<td class="text-sm">
								{#if row.lat != null && row.lng != null}
									{row.lat.toFixed(5)}, {row.lng.toFixed(5)}
								{:else}
									<span class="opacity-60">—</span>
								{/if}
							</td>
							<td class="text-sm">
								{#if row.duplicate}
									<span class="badge badge-compact badge-amber" title={row.duplicateReason ?? ''}>Duplicate</span>
								{/if}
								{#each row.warnings as w}
									<span class="block opacity-75">{w}</span>
								{/each}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<form method="POST" action="?/confirm" class="mt-4 flex flex-wrap items-end gap-3">
			<input type="hidden" name="rows" value={rowsJson()} />
			<input type="hidden" name="skipDuplicates" value={skipDuplicates ? 'true' : 'false'} />
			<div class="field">
				<label class="label" for="categoryId">Assign category</label>
				<select id="categoryId" name="categoryId" class="input">
					<option value="">Keep as parsed</option>
					{#each data.categories as c (c.id)}
						<option value={c.id}>{c.name}</option>
					{/each}
				</select>
			</div>
			<label class="flex items-center gap-2 pb-2 text-sm">
				<input
					type="checkbox"
					checked={skipDuplicates}
					onchange={toggleSkipDuplicates}
				/>
				Skip duplicates
			</label>
			<button type="submit" class="btn btn-primary" disabled={selectedRows.length === 0}>
				Import {selectedRows.length} place{selectedRows.length === 1 ? '' : 's'}
			</button>
			<a href="/places/import" class="btn btn-ghost">Start over</a>
		</form>
	</section>
{/if}

{#if form?.imported}
	<section class="card mt-6 p-5 sm:p-6">
		<div class="notice {form.imported.errors.length ? 'notice-info' : 'notice-success'}">
			<p>
				Imported {form.imported.created} place{form.imported.created === 1 ? '' : 's'}
				{#if form.imported.skippedDuplicates > 0}
					— skipped {form.imported.skippedDuplicates} duplicate{form.imported.skippedDuplicates === 1 ? '' : 's'}
				{/if}.
			</p>
			{#if form.imported.errors.length}
				<p class="mt-2 font-semibold">{form.imported.errors.length} row(s) failed:</p>
				<ul class="mt-1 list-inside list-disc text-sm">
					{#each form.imported.errors as e}
						<li>Row {e.index + 1} (“{e.name}”): {e.message}</li>
					{/each}
				</ul>
			{/if}
		</div>
		<a href="/places" class="btn btn-secondary mt-4">Go to places</a>
	</section>
{/if}
