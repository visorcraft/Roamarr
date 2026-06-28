<script lang="ts">
	import { DateTime } from 'luxon';
	import { SEG } from '$lib/segmentLabels';
	import Icon from '$lib/components/Icon.svelte';
	import { formatDestination } from '$lib/tripDestination';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const trip = $derived(data.trip);
	const companions = $derived(data.companions ?? []);
	const destinationLabel = $derived(formatDestination(trip.destinationCityName, trip.destinationCountryCode));

	type SegmentRow = {
		type: string;
		title: string;
		startAt: string | null;
		endAt: string | null;
		location: string | null;
		confirmationNumber?: string | null;
		detailsJson?: string | null;
		startTz?: string;
		endTz?: string | null;
		meetingPoint?: string | null;
		meetingAt?: string | null;
	};

	const segmentList = $derived(data.segments as SegmentRow[]);

	function fmtTime(iso: string | null | undefined, tz = 'UTC') {
		if (!iso) return '';
		try {
			return new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: tz }).format(new Date(iso));
		} catch {
			return '';
		}
	}

	function fmtDateLong(iso: string | null | undefined) {
		if (!iso) return '';
		try {
			return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date(`${iso}T12:00:00`));
		} catch {
			return iso;
		}
	}

	function tripDays(start: string | null | undefined, end: string | null | undefined) {
		if (!start || !end) return null;
		const s = DateTime.fromISO(start);
		const e = DateTime.fromISO(end);
		if (!s.isValid || !e.isValid) return null;
		return Math.max(1, Math.ceil(e.diff(s, 'days').days) + 1);
	}

	function groupSegmentsByDay(segments: SegmentRow[]) {
		const sorted = [...segments].sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''));
		const groups: { key: string; label: string; segments: SegmentRow[] }[] = [];
		const index = new Map<string, number>();
		for (const s of sorted) {
			let key = 'unscheduled';
			let label = 'Unscheduled';
			if (s.startAt) {
				const dt = DateTime.fromISO(s.startAt, { zone: 'utc' }).setZone(s.startTz ?? 'UTC');
				if (dt.isValid) {
					key = dt.toISODate()!;
					label = dt.toFormat('EEEE, MMMM d, yyyy');
				}
			}
			const existing = index.get(key);
			if (existing != null) groups[existing].segments.push(s);
			else {
				index.set(key, groups.length);
				groups.push({ key, label, segments: [s] });
			}
		}
		return groups;
	}

	const dayGroups = $derived(groupSegmentsByDay(segmentList));
	const days = $derived(tripDays(trip.startDate, trip.endDate));
</script>

<svelte:head>
	<title>{trip.name} — Printable Itinerary</title>
</svelte:head>

<div class="print-itinerary mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
	<header class="print-header border-b border-white/10 pb-6" style="border-color: var(--theme-line)">
		<div class="print-actions print-hidden mb-4 flex flex-wrap items-center justify-between gap-2">
			<a href={`/trips/${trip.id}`} class="btn btn-ghost">
				<Icon name="back" class="h-4 w-4" />
				Back to trip
			</a>
			<button class="btn btn-primary" onclick={() => window.print()}>
				<Icon name="print" class="h-4 w-4" />
				Print
			</button>
		</div>

		<h1 class="print-title font-display text-3xl font-extrabold text-white" style="color: var(--theme-strong)">{trip.name}</h1>

		<div class="print-meta mt-3 flex flex-wrap gap-3 text-sm text-slate-300" style="color: var(--theme-ink)">
			{#if destinationLabel}
				<span class="print-meta-item inline-flex items-center gap-1.5">
					<Icon name="location" class="h-4 w-4" />
					{destinationLabel}
				</span>
			{/if}
			{#if trip.startDate || trip.endDate}
				<span class="print-meta-item inline-flex items-center gap-1.5">
					{fmtDateLong(trip.startDate) || '—'}
					<span class="text-slate-400">→</span>
					{fmtDateLong(trip.endDate) || '—'}
				</span>
			{/if}
			{#if days}
				<span class="print-meta-item inline-flex items-center gap-1.5">{days} day{days === 1 ? '' : 's'}</span>
			{/if}
			<span class="print-meta-item inline-flex items-center gap-1.5">{segmentList.length} segment{segmentList.length === 1 ? '' : 's'}</span>
		</div>
	</header>

	{#if companions.length}
		<section class="print-section mt-8">
			<h2 class="print-section-title section-title mb-3 text-xl">Travelers</h2>
			<ul class="print-companion-list list-inside list-disc space-y-1 text-sm">
				{#each companions as c (c.id)}
					<li class="print-companion text-slate-300" style="color: var(--theme-ink)">
						<span class="font-medium">{c.name}</span>
						<span class="text-slate-500 capitalize">({c.category})</span>
						{#if c.notes}<span class="text-slate-500">— {c.notes}</span>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="print-section mt-8">
		<h2 class="print-section-title section-title mb-3 text-xl">Itinerary</h2>

		{#if dayGroups.length}
			<div class="print-days space-y-6">
				{#each dayGroups as group (group.key)}
					<div class="print-day">
						<h3 class="print-day-title subsection-title mb-2 pb-1 border-b border-white/5" style="border-color: color-mix(in oklab, var(--theme-line) 65%, transparent)">{group.label}</h3>
						<ul class="print-segments space-y-3">
							{#each group.segments as s, i (s.title + '-' + i)}
								<li class="print-segment flex gap-4 text-sm">
									<div class="print-segment-time w-16 shrink-0 pt-0.5 text-right font-mono text-xs text-slate-500" style="color: var(--theme-readable-muted)">
										{#if s.startAt}
											{fmtTime(s.startAt, s.startTz ?? 'UTC')}
										{:else}
											—
										{/if}
									</div>
									<div class="print-segment-body min-w-0 flex-1">
										<div class="print-segment-header flex flex-wrap items-center gap-2">
											<span class="badge badge-slate badge-compact">{SEG[s.type as keyof typeof SEG]?.label ?? s.type}</span>
											<h4 class="print-segment-title font-semibold text-white" style="color: var(--theme-strong)">{s.title}</h4>
										</div>
										{#if s.endAt}
											{@const endTz = s.endTz ?? s.startTz ?? 'UTC'}
											<p class="print-segment-meta mt-1 text-slate-400" style="color: var(--theme-readable-muted)">Until {fmtTime(s.endAt, endTz)} ({endTz})</p>
										{/if}
										{#if s.location}
											<p class="print-segment-meta mt-1 text-slate-400" style="color: var(--theme-readable-muted)">{s.location}</p>
										{/if}
										{#if s.confirmationNumber}
											<p class="print-segment-meta mt-1 text-slate-400" style="color: var(--theme-readable-muted)">Confirmation {s.confirmationNumber}</p>
										{/if}
										{#if s.meetingPoint || s.meetingAt}
											<p class="print-segment-meta mt-1 text-slate-400" style="color: var(--theme-readable-muted)">
												{#if s.meetingPoint}<strong>Rally point:</strong> {s.meetingPoint}{/if}
												{#if s.meetingPoint && s.meetingAt} · {/if}
												{#if s.meetingAt}<strong>Meet at:</strong> {fmtTime(s.meetingAt, s.startTz ?? 'UTC')} ({s.startTz ?? 'UTC'}){/if}
											</p>
										{/if}
										{#if s.detailsJson}
											<pre class="print-segment-details mt-2 whitespace-pre-wrap rounded bg-white/[0.03] p-2 font-mono text-xs text-slate-400 ring-1 ring-white/5" style="background: var(--theme-subtle); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--theme-line) 72%, transparent); color: var(--theme-readable-muted)">{s.detailsJson}</pre>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty-text py-6 text-center text-sm text-slate-500">No segments yet.</p>
		{/if}
	</section>
</div>

<style>
	@media print {
		.print-hidden {
			display: none !important;
		}
		.print-itinerary {
			max-width: none;
			padding: 0;
			color: #000;
			background: #fff;
		}
		.print-title,
		.print-section-title,
		.print-day-title,
		.print-segment-title {
			color: #000;
		}
		.print-meta,
		.print-companion,
		.print-segment-meta {
			color: #333;
		}
		.print-segment-time {
			color: #555;
		}
		.print-segment-details {
			background: #f5f5f5;
			color: #333;
			box-shadow: none;
			border: 1px solid #ddd;
		}
		.print-header,
		.print-day-title {
			border-color: #ccc;
		}
	}
</style>
