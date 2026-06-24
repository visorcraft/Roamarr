<script lang="ts">
	import CopyButton from '$lib/components/CopyButton.svelte';
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import { SEG, SEGMENT_TYPES } from '$lib/segmentLabels';
	import { DateTime } from 'luxon';
	import { trips } from '$lib/server/db/schema';
	import { renderMarkdown } from '$lib/markdown';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form?: { error?: string; errors?: Record<string, string> } } = $props();
	let editingId = $state<number | null>(null);

	type SharedSegment = {
		type: string;
		title: string;
		startAt: string | null;
		endAt: string | null;
		location: string | null;
		confirmationNumber?: string | null;
		detailsJson?: string | null;
		startTz?: string;
	};

	type SegmentRow = SharedSegment & { id?: number; startTz: string };

	const visBadge: Record<string, string> = {
		private: 'badge-slate',
		groups: 'badge-brand',
		public: 'badge-green'
	};

	const statusBadge: Record<string, { label: string; class: string }> = {
		upcoming: { label: 'Upcoming', class: 'badge-brand' },
		active: { label: 'In progress', class: 'badge-green' },
		past: { label: 'Completed', class: 'badge-slate' },
		unknown: { label: 'Planned', class: 'badge-slate' }
	};

	function fmt(iso: string | null | undefined, tz = 'UTC') {
		if (!iso) return '';
		try {
			return new Intl.DateTimeFormat('en-US', {
				dateStyle: 'medium',
				timeStyle: 'short',
				timeZone: tz
			}).format(new Date(iso));
		} catch {
			return iso;
		}
	}

	function fmtTime(iso: string | null | undefined, tz = 'UTC') {
		if (!iso) return '';
		try {
			return new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: tz }).format(new Date(iso));
		} catch {
			return '';
		}
	}

	function fmtDateOnly(iso: string | null | undefined) {
		if (!iso) return '';
		try {
			return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date(`${iso}T12:00:00`));
		} catch {
			return iso;
		}
	}

	function toDatetimeLocal(iso: string | null | undefined, tz = 'UTC') {
		if (!iso) return '';
		const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
		if (!dt.isValid) return iso;
		return dt.toFormat("yyyy-MM-dd'T'HH:mm");
	}

	function tripDays(start: string | null | undefined, end: string | null | undefined) {
		if (!start || !end) return null;
		const s = DateTime.fromISO(start);
		const e = DateTime.fromISO(end);
		if (!s.isValid || !e.isValid) return null;
		return Math.max(1, Math.ceil(e.diff(s, 'days').days) + 1);
	}

	function tripStatus(start: string | null | undefined, end: string | null | undefined) {
		const today = DateTime.now().toISODate()!;
		if (!start && !end) return 'unknown';
		if (end && end < today) return 'past';
		if (start && start > today) return 'upcoming';
		return 'active';
	}

	function heroHue(text: string) {
		let h = 0;
		for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
		return h;
	}

	function posterInitials(name: string, destination: string | null | undefined) {
		const src = destination?.trim() || name;
		return src
			.split(/[\s,]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('');
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

	const trip = $derived(data.trip);
	const isEditor = $derived(data.editor === true);
	const ownerTrip = $derived(data.owner === true ? (trip as typeof trips.$inferSelect) : undefined);
	const segmentList = $derived(
		isEditor ? (data.segments as SegmentRow[]) : ((data.trip as { segments: SharedSegment[] }).segments as SegmentRow[])
	);
	const dayGroups = $derived(groupSegmentsByDay(segmentList));
	const days = $derived(tripDays(trip.startDate, trip.endDate));
	const status = $derived(tripStatus(trip.startDate, trip.endDate));
	const heroAccent = $derived(heroHue(trip.destination ?? trip.name));
	const typeCounts = $derived(
		SEGMENT_TYPES.map((type) => ({
			type,
			count: segmentList.filter((s) => s.type === type).length
		})).filter((t) => t.count > 0)
	);
</script>

<div class="trip-detail">
	<!-- Hero -->
	<section class="trip-hero">
		<div
			class="trip-hero-backdrop"
			style="background-image: radial-gradient(ellipse 120% 100% at 70% 0%, hsl({heroAccent} 55% 35% / 0.55), transparent 55%), linear-gradient(135deg, hsl({heroAccent} 40% 22%) 0%, hsl({(heroAccent + 40) % 360} 35% 14%) 100%);"
		></div>
		<div class="trip-hero-scrim"></div>

		<div class="relative px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
			<a href="/trips" class="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-white">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="m15 18-6-6 6-6" /></svg>
				Back to trips
			</a>

			<div class="flex flex-col gap-6 sm:flex-row sm:items-end">
				<div
					class="trip-poster grid place-items-center bg-gradient-to-br from-indigo-500/30 via-surface2 to-fuchsia-500/20"
					style="background-image: linear-gradient(145deg, hsl({heroAccent} 45% 28% / 0.5), hsl({(heroAccent + 50) % 360} 35% 16% / 0.8));"
				>
					<div class="text-center">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto h-8 w-8 text-white/70"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
						<p class="mt-2 font-display text-2xl font-bold text-white">{posterInitials(trip.name, trip.destination)}</p>
					</div>
				</div>

				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						{#if !isEditor}
							<span class="badge badge-brand badge-compact">Shared view</span>
						{/if}
						<span class="badge badge-compact {statusBadge[status].class}">{statusBadge[status].label}</span>
						{#if ownerTrip}
							<span class="badge badge-compact {visBadge[ownerTrip.defaultVisibility] ?? 'badge-slate'} capitalize">{ownerTrip.defaultVisibility}</span>
						{/if}
					</div>

					<h1 class="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{trip.name}</h1>

					<div class="mt-3 flex flex-wrap gap-2">
						{#if trip.destination}
							<span class="trip-meta-pill">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-slate-500"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
								{trip.destination}
							</span>
						{/if}
						{#if trip.startDate || trip.endDate}
							<span class="trip-meta-pill">
								<span class="font-mono leading-none">{trip.startDate || '—'}</span>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="trip-meta-pill-arrow" aria-hidden="true"><path d="M5 12h14" /><path d="m13 7 6 5-6 5" /></svg>
								<span class="font-mono leading-none">{trip.endDate || '—'}</span>
							</span>
						{/if}
						{#if days}
							<span class="trip-meta-pill">{days} day{days === 1 ? '' : 's'}</span>
						{/if}
						<span class="trip-meta-pill">{segmentList.length} segment{segmentList.length === 1 ? '' : 's'}</span>
					</div>
				</div>

				<div class="flex flex-wrap gap-2 sm:justify-end">
					<a href={`/trips/${trip.id}/calendar`} class="btn btn-ghost">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
						Calendar
					</a>
					{#if isEditor}
						<a href={`/trips/${trip.id}/edit`} class="btn btn-ghost">Edit trip</a>
						<form method="POST" action="?/duplicate">
							<button class="btn btn-ghost">Duplicate</button>
						</form>
						{#if data.owner === true}
							<a href={`/trips/${trip.id}/share`} class="btn btn-primary">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" x2="12" y1="2" y2="15" /></svg>
								Share
							</a>
							{#if data.publicShareUrl}
								<CopyButton text={data.publicShareUrl} class="btn btn-ghost" label="Copy public link" />
							{/if}
						{/if}
					{/if}
				</div>
			</div>
		</div>
	</section>

	{#if form?.error}<p class="notice notice-error trip-detail-body mt-6">{form.error}</p>{/if}

	<div class="trip-detail-body mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_17.5rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
		<!-- Main column -->
		<div class="min-w-0 space-y-8">
			{#if ownerTrip?.notes}
				<section>
					<h2 class="section-title mb-3">Overview</h2>
					<div class="prose prose-invert max-w-none text-sm leading-relaxed text-slate-300">{@html renderMarkdown(ownerTrip.notes)}</div>
				</section>
			{/if}

			<section>
				<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
					<h2 class="section-title">Itinerary</h2>
					{#if isEditor}
						<a href={`/trips/${trip.id}/segments/new`} class="btn btn-ghost">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-4 w-4"><path d="M5 12h14M12 5v14" /></svg>
							Add segment
						</a>
					{/if}
				</div>

				{#if dayGroups.length}
					<div class="space-y-8">
						{#each dayGroups as group (group.key)}
							<div>
								<div class="trip-timeline-day">
									<span class="text-sm font-semibold text-white">{group.label}</span>
									<span class="text-[0.938rem] text-slate-500">{group.segments.length} item{group.segments.length === 1 ? '' : 's'}</span>
								</div>

								<div class="trip-timeline-track space-y-3">
									{#each group.segments as s, i (s.id ?? `${group.key}-${i}`)}
										<div class="relative">
											<span class="trip-timeline-node">
												<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">{@html SEG[s.type as keyof typeof SEG]?.icon ?? ''}</svg>
											</span>

											{#if isEditor && editingId === s.id}
												<form method="POST" action={`/trips/${trip.id}/segments?/update`} class="trip-timeline-card grid gap-4 sm:grid-cols-2">
													<input type="hidden" name="segmentId" value={s.id} />
													<div class="field">
														<label class="label" for={`title-${s.id}`}>Title</label>
														<input id={`title-${s.id}`} name="title" value={s.title} class="input {form?.errors?.title ? 'input-error' : ''}" required />
														{#if form?.errors?.title}<p class="field-error">{form.errors.title}</p>{/if}
													</div>
													<div class="field">
														<label class="label" for={`localStart-${s.id}`}>Starts</label>
														<input id={`localStart-${s.id}`} name="localStart" type="datetime-local" value={toDatetimeLocal(s.startAt, s.startTz)} class="input {form?.errors?.localStart ? 'input-error' : ''}" required />
														{#if form?.errors?.localStart}<p class="field-error">{form.errors.localStart}</p>{/if}
													</div>
													<div class="field">
														<label class="label" for={`startTz-${s.id}`}>Timezone</label>
														<TimezoneSelect id={`startTz-${s.id}`} name="startTz" value={s.startTz} class="input {form?.errors?.startTz ? 'input-error' : ''}" />
														{#if form?.errors?.startTz}<p class="field-error">{form.errors.startTz}</p>{/if}
													</div>
													<div class="field">
														<label class="label" for={`endAt-${s.id}`}>Ends</label>
														<input id={`endAt-${s.id}`} name="endAt" type="datetime-local" value={toDatetimeLocal(s.endAt, s.startTz)} class="input {form?.errors?.endAt ? 'input-error' : ''}" />
														{#if form?.errors?.endAt}<p class="field-error">{form.errors.endAt}</p>{/if}
													</div>
													<div class="field">
														<label class="label" for={`location-${s.id}`}>Location</label>
														<input id={`location-${s.id}`} name="location" value={s.location ?? ''} class="input {form?.errors?.location ? 'input-error' : ''}" />
														{#if form?.errors?.location}<p class="field-error">{form.errors.location}</p>{/if}
													</div>
													<div class="field">
														<label class="label" for={`confirmationNumber-${s.id}`}>Confirmation #</label>
														<input id={`confirmationNumber-${s.id}`} name="confirmationNumber" value={s.confirmationNumber ?? ''} class="input {form?.errors?.confirmationNumber ? 'input-error' : ''}" />
														{#if form?.errors?.confirmationNumber}<p class="field-error">{form.errors.confirmationNumber}</p>{/if}
													</div>
													<div class="field sm:col-span-2">
														<label class="label" for={`detailsJson-${s.id}`}>Details (JSON)</label>
														<textarea id={`detailsJson-${s.id}`} name="detailsJson" class="input h-20 font-mono text-xs {form?.errors?.detailsJson ? 'input-error' : ''}">{s.detailsJson ?? ''}</textarea>
														{#if form?.errors?.detailsJson}<p class="field-error">{form.errors.detailsJson}</p>{/if}
													</div>
													<div class="flex gap-2 sm:col-span-2">
														<button type="button" class="btn btn-ghost" onclick={() => (editingId = null)}>Cancel</button>
														<button class="btn btn-primary">Save</button>
													</div>
												</form>
											{:else}
												<article class="trip-timeline-card">
													<div class="flex items-start gap-3">
														{#if s.startAt}
															<div class="w-16 shrink-0 pt-0.5 text-right font-mono text-xs text-indigo-300/90">
																{fmtTime(s.startAt, s.startTz ?? 'UTC')}
															</div>
														{/if}
														<div class="min-w-0 flex-1">
															<div class="flex flex-wrap items-center gap-2">
																<span class="badge badge-slate">{SEG[s.type as keyof typeof SEG]?.label ?? s.type}</span>
																<h3 class="font-semibold text-white">{s.title}</h3>
															</div>
															{#if s.endAt}
																<p class="mt-1 font-mono text-xs text-slate-500">
																	Until {fmtTime(s.endAt, s.startTz ?? 'UTC')}
																</p>
															{/if}
															{#if s.location}
																<p class="mt-1.5 text-sm text-slate-400">{s.location}</p>
															{/if}
															{#if isEditor && s.confirmationNumber}
																<p class="mt-1 font-mono text-xs text-slate-500">Confirmation {s.confirmationNumber}</p>
															{/if}
															{#if !isEditor && s.detailsJson}
																<div class="mt-2 rounded-lg bg-white/[0.03] p-2 ring-1 ring-white/5">
																	<pre class="whitespace-pre-wrap font-mono text-[10px] text-slate-400">{s.detailsJson}</pre>
																</div>
															{/if}
														</div>
														{#if isEditor && s.id}
															<div class="flex shrink-0 gap-1">
																<button type="button" class="btn btn-ghost btn-ghost-muted" onclick={() => (editingId = s.id ?? null)}>Edit</button>
																<form method="POST" action={`/trips/${trip.id}/segments?/delete`}>
																	<input type="hidden" name="segmentId" value={s.id} />
																	<button class="btn btn-ghost btn-ghost-danger">Delete</button>
																</form>
															</div>
														{/if}
													</div>
												</article>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="card grid place-items-center gap-3 p-12 text-center">
						<div class="grid h-12 w-12 place-items-center rounded-full bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-400/20">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>
						</div>
						<p class="text-slate-300">{isEditor ? 'No segments yet — add your first flight, stay, or activity.' : 'No itinerary shared.'}</p>
						{#if isEditor}
							<a href={`/trips/${trip.id}/segments/new`} class="btn btn-primary">Add segment</a>
						{/if}
					</div>
				{/if}
			</section>

			{#if isEditor && data.owner === true && (data.providers?.length || data.watches?.length)}
				<section class="card p-5">
					<div class="mb-3 flex flex-wrap items-center gap-3">
						<h2 class="section-title mr-auto">Fare watch</h2>
						{#if data.providers?.length}
							<form method="POST" action={`/trips/${trip.id}/fare-watch?/enable`} class="flex items-center gap-2">
								<select name="providerId" class="select w-auto">
									{#each data.providers as p (p.id)}
										<option value={p.id}>{p.label || p.providerKey}</option>
									{/each}
								</select>
								<button class="btn btn-ghost">Enable</button>
							</form>
						{/if}
					</div>
					{#if data.watches?.length}
						<ul class="space-y-2">
							{#each data.watches as w (w.id)}
								{@const last = w.lastResultJson ? JSON.parse(w.lastResultJson) : null}
								<li class="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-2">
											<span class="badge badge-slate">{w.label || w.providerKey}</span>
											<span class="badge {w.status === 'active' ? 'badge-brand' : 'badge-slate'}">{w.status}</span>
										</div>
										{#if last?.summary}
											<p class="mt-1 text-xs text-slate-400">{last.summary}</p>
										{/if}
										{#if w.lastCheckedAt}
											<p class="mt-0.5 text-xs text-slate-500">Last checked: {fmt(w.lastCheckedAt)}</p>
										{/if}
									</div>
									<div class="flex items-center gap-1">
										<form method="POST" action={`/trips/${trip.id}/fare-watch?/check`}>
											<input type="hidden" name="watchId" value={w.id} />
											<button class="btn btn-ghost">Check now</button>
										</form>
										{#if w.status === 'active'}
											<form method="POST" action={`/trips/${trip.id}/fare-watch?/pause`}>
												<input type="hidden" name="watchId" value={w.id} />
												<button class="btn btn-ghost btn-ghost-amber">Pause</button>
											</form>
										{:else}
											<form method="POST" action={`/trips/${trip.id}/fare-watch?/resume`}>
												<input type="hidden" name="watchId" value={w.id} />
												<button class="btn btn-ghost btn-ghost-success">Resume</button>
											</form>
										{/if}
										<form method="POST" action={`/trips/${trip.id}/fare-watch?/delete`}>
											<input type="hidden" name="watchId" value={w.id} />
											<button class="btn btn-ghost btn-ghost-danger">Delete</button>
										</form>
									</div>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="py-4 text-center text-sm text-slate-500">No fare watches enabled for this trip.</p>
					{/if}
				</section>
			{/if}
		</div>

		<!-- Sidebar -->
		<aside class="space-y-4 lg:sticky lg:top-6 lg:self-start">
			<div class="trip-sidebar-card">
				<h2 class="mb-3 text-sm font-semibold text-white">Trip details</h2>
				<dl class="trip-sidebar-dl">
					<div>
						<dt>Status</dt>
						<dd><span class="badge badge-compact {statusBadge[status].class}">{statusBadge[status].label}</span></dd>
					</div>
					{#if trip.startDate}
						<div>
							<dt>Start date</dt>
							<dd>{fmtDateOnly(trip.startDate)}</dd>
						</div>
					{/if}
					{#if trip.endDate}
						<div>
							<dt>End date</dt>
							<dd>{fmtDateOnly(trip.endDate)}</dd>
						</div>
					{/if}
					{#if days}
						<div>
							<dt>Duration</dt>
							<dd>{days} day{days === 1 ? '' : 's'}</dd>
						</div>
					{/if}
					{#if trip.destination}
						<div>
							<dt>Destination</dt>
							<dd>{trip.destination}</dd>
						</div>
					{/if}
					{#if ownerTrip}
						<div>
							<dt>Visibility</dt>
							<dd class="capitalize">{ownerTrip.defaultVisibility}</dd>
						</div>
					{/if}
				</dl>
			</div>

			{#if typeCounts.length}
				<div class="trip-sidebar-card">
					<h2 class="mb-3 text-sm font-semibold text-white">Plans by type</h2>
					<ul class="space-y-2">
						{#each typeCounts as t (t.type)}
							<li class="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm ring-1 ring-white/5">
								<span class="flex items-center gap-2 text-slate-300">
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-indigo-300/80">{@html SEG[t.type].icon}</svg>
									{SEG[t.type].label}
								</span>
								<span class="font-mono text-xs text-slate-500">{t.count}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if isEditor && data.owner === true}
				<div class="trip-sidebar-card">
					<h2 class="mb-3 text-sm font-semibold text-white">Calendar feed</h2>
					{#if data.feedUrl}
						<p class="text-sm leading-relaxed text-slate-400">Subscribe to this trip with any calendar app.</p>
						<div class="mt-2 flex items-start gap-2">
							<p class="flex-1 break-all rounded-lg bg-white/[0.03] px-2.5 py-2 font-mono text-[10px] leading-relaxed text-slate-300 ring-1 ring-white/5">{data.feedUrl}</p>
							<CopyButton text={data.feedUrl} class="btn btn-ghost shrink-0" label="Copy" />
						</div>
						<div class="mt-3 flex flex-col gap-2">
							<form method="POST" action="?/regenerateCalendarFeed">
								<button class="btn btn-primary w-full">Regenerate URL</button>
							</form>
							<form method="POST" action="?/revokeCalendarFeed">
								<button class="btn btn-danger w-full">Revoke feed</button>
							</form>
						</div>
					{:else}
						<p class="text-xs text-slate-400">Generate a public .ics feed URL for this trip.</p>
						<form method="POST" action="?/regenerateCalendarFeed" class="mt-3">
							<button class="btn btn-primary w-full">Generate feed URL</button>
						</form>
					{/if}
				</div>
			{/if}

			{#if isEditor}
				<div class="trip-sidebar-card">
					<h2 class="mb-3 text-sm font-semibold text-white">Quick links</h2>
					<nav class="flex flex-col gap-1">
						<a href={`/trips/${trip.id}/edit`} class="rounded-lg px-2.5 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white">Edit trip info</a>
						<a href={`/trips/${trip.id}/calendar`} class="rounded-lg px-2.5 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white">Download calendar</a>
						{#if data.owner === true}
							<a href={`/trips/${trip.id}/share`} class="rounded-lg px-2.5 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white">Sharing settings</a>
						{/if}
					</nav>
				</div>
			{/if}
		</aside>
	</div>
</div>
