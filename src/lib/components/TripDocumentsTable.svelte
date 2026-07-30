<script lang="ts">
	import { html } from 'gridjs';
	import { invalidateAll } from '$app/navigation';
	import { applyAction, deserialize } from '$app/forms';
	import GridTable, { type FetchOpts } from '$lib/components/GridTable.svelte';
	import { formatFileSize } from '$lib/fileSize';
	import { escapeHtml } from '$lib/escapeHtml';

	export interface TripDocumentRow {
		id: number;
		label?: string | null;
		filename: string;
		contentType?: string | null;
		sizeBytes: number;
		segmentId?: number | null;
		notes?: string | null;
		createdAt?: string | Date | null;
	}

	let {
		tripId,
		documents = [],
		canEdit = false,
		pageSize = 5,
		showScope = true,
		segmentTitles = {},
		emptyMessage = 'No files uploaded yet.'
	}: {
		tripId: number;
		documents?: TripDocumentRow[];
		canEdit?: boolean;
		pageSize?: number;
		/** Show Whole trip / segment title column. */
		showScope?: boolean;
		segmentTitles?: Record<number, string>;
		emptyMessage?: string;
	} = $props();

	let grid: { reload: () => void } | undefined = $state();

	function scopeLabel(segmentId: number | null | undefined): string {
		if (segmentId == null) return 'Whole trip';
		return segmentTitles[segmentId] ?? `Segment #${segmentId}`;
	}

	function compareValue(row: Record<string, unknown>, key: string): string {
		if (key === 'sizeBytes') return String(Number(row.sizeBytes ?? 0)).padStart(12, '0');
		if (key === 'scope') return scopeLabel(row.segmentId as number | null).toLowerCase();
		if (key === 'name') return String(row.label || row.filename || '').toLowerCase();
		return String(row[key] ?? '').toLowerCase();
	}

	const columns = $derived([
		{
			id: 'name',
			name: 'Name',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) => {
				const id = Number(row.id);
				const label = escapeHtml(String(row.label || row.filename || 'File'));
				return html(
					`<a href="/trips/${tripId}/documents/${id}" target="_blank" rel="noopener noreferrer" class="link">${label}</a>`
				);
			}
		},
		...(showScope
			? [
					{
						id: 'scope',
						name: 'Scope',
						sort: true,
						formatter: (_cell: unknown, row: Record<string, unknown>) =>
							html(
								`<span style="color: var(--theme-readable-muted)">${escapeHtml(scopeLabel(row.segmentId as number | null))}</span>`
							)
					}
				]
			: []),
		{
			id: 'contentType',
			name: 'Type',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span style="color: var(--theme-readable-muted)">${escapeHtml(String(row.contentType ?? '—'))}</span>`
				)
		},
		{
			id: 'sizeBytes',
			name: 'Size',
			sort: true,
			formatter: (_cell: unknown, row: Record<string, unknown>) =>
				html(
					`<span class="font-mono text-sm" style="color: var(--theme-readable-muted)">${escapeHtml(formatFileSize(Number(row.sizeBytes ?? 0)))}</span>`
				)
		}
	]);

	const actions = $derived(
		canEdit
			? [
					{
						id: 'open',
						label: 'Open'
					},
					{
						id: 'delete',
						label: 'Delete',
						variant: 'danger' as const,
						confirm: true,
						confirmTitle: 'Delete file',
						confirmMessage: (row: Record<string, unknown>) =>
							`Delete “${String(row.label || row.filename || 'this file')}”? This cannot be undone.`,
						confirmLabel: 'Delete'
					}
				]
			: [
					{
						id: 'open',
						label: 'Open'
					}
				]
	);

	async function fetchData(opts: FetchOpts) {
		const search = String(opts.url.search ?? '')
			.trim()
			.toLowerCase();
		const sort = opts.url.sort ? String(opts.url.sort) : null;
		const dir = opts.url.dir === 'desc' ? -1 : 1;
		// Grid.js server pagination is 0-based (see VisitedPlacePage / GridTable).
		const page = Number(opts.url.page ?? 0) || 0;
		const limit = Number(opts.url.limit ?? pageSize) || pageSize;

		let rows: Record<string, unknown>[] = documents.map((d) => ({
			id: d.id,
			label: d.label,
			filename: d.filename,
			contentType: d.contentType,
			sizeBytes: d.sizeBytes,
			segmentId: d.segmentId ?? null,
			notes: d.notes,
			createdAt: d.createdAt
		}));

		if (search) {
			rows = rows.filter((row) =>
				['name', 'filename', 'label', 'contentType', 'scope', 'notes'].some((key) => {
					if (key === 'name') return compareValue(row, 'name').includes(search);
					if (key === 'scope') return compareValue(row, 'scope').includes(search);
					return compareValue(row, key).includes(search);
				})
			);
		}

		if (sort) {
			rows = [...rows].sort((a, b) => {
				if (sort === 'sizeBytes') {
					return (Number(a.sizeBytes) - Number(b.sizeBytes)) * dir;
				}
				return compareValue(a, sort).localeCompare(compareValue(b, sort)) * dir;
			});
		}

		const total = rows.length;
		const start = Math.max(0, page) * Math.max(1, limit);
		return { rows: rows.slice(start, start + limit), total };
	}

	async function handleAction(e: Event) {
		const { action, row } = (e as CustomEvent<{ action: string; row: Record<string, unknown> }>)
			.detail;
		const id = Number(row.id);
		if (!Number.isFinite(id)) return;
		if (action === 'open') {
			window.open(`/trips/${tripId}/documents/${id}`, '_blank', 'noopener,noreferrer');
			return;
		}
		if (action === 'delete' && canEdit) {
			// Fetch POST (no nested <form>) so this table works inside SegmentEditForm.
			const body = new FormData();
			body.set('documentId', String(id));
			const res = await fetch(`/trips/${tripId}?/deleteTripDocument`, {
				method: 'POST',
				body,
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await res.text());
			if (result.type === 'success' || result.type === 'redirect') {
				await invalidateAll();
				if (result.type === 'redirect') {
					// Stay on the trip page; invalidateAll refreshes the document list.
				} else {
					await applyAction(result);
				}
				queueMicrotask(() => grid?.reload());
			} else if (result.type === 'failure' || result.type === 'error') {
				await applyAction(result);
			}
		}
	}

	// Reload when the document list changes (after upload/delete invalidate).
	$effect(() => {
		void documents;
		void documents.length;
		queueMicrotask(() => grid?.reload());
	});
</script>

<div class="trip-documents-table">
	<GridTable
		bind:this={grid}
		{columns}
		{fetchData}
		{actions}
		{pageSize}
		{emptyMessage}
		onaction={handleAction}
	/>
</div>
