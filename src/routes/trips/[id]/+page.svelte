<script lang="ts">
	import CopyButton from '$lib/components/CopyButton.svelte';
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import CardSelect from '$lib/components/CardSelect.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { SEG, SEGMENT_TYPES, type SegmentType } from '$lib/segmentLabels';
	import { DateTime } from 'luxon';
	import type { trips } from '$lib/server/db/schema';
	import { renderMarkdown } from '$lib/markdown';
	import { formatDateTime, formatDate, formatTime } from '$lib/dateFormat';
	import { formatCents } from '$lib/money';
	import { REMINDER_OFFSETS } from '$lib/reminderOffsets';
	import { SEGMENT_STATUSES, segmentStatusLabel, segmentStatusClass } from '$lib/segmentStatus';
	import { tripStatusBadge } from '$lib/tripStatus';
	import { visibilityBadgeClass } from '$lib/visibility';
	import type { PageData } from './$types';

	let { data, form }: { data: PageData; form?: { error?: string; errors?: Record<string, string> } } = $props();
	let editingId = $state<number | null>(null);
	let editingCompanionId = $state<number | null>(null);
	let showCompanionNotesId = $state<number | null>(null);
	let showAddCompanionNotes = $state(false);
	let selectedCompanionByPoll = $state<Record<number, string>>({});
	let selectedTypes = $state<Set<SegmentType>>(new Set());
	let selectedSegmentIds = $state<Set<number>>(new Set());
	let segmentQuery = $state('');

	function toggleType(type: SegmentType) {
		const next = new Set(selectedTypes);
		if (next.has(type)) {
			next.delete(type);
		} else {
			next.add(type);
		}
		selectedTypes = next;
	}

	type SharedSegment = {
		type: string;
		title: string;
		startAt: string | null;
		endAt: string | null;
		location: string | null;
		status?: string | null;
		confirmationNumber?: string | null;
		detailsJson?: string | null;
		startTz?: string;
		endTz?: string | null;
		meetingPoint?: string | null;
		meetingAt?: string | null;
	};

	type SegmentRow = SharedSegment & {
		id?: number;
		startTz: string;
		endTz?: string | null;
		cardId?: number | null;
		paymentStatus?: string | null;
		paymentDueDate?: string | null;
	};

	const cardMap = $derived(new Map((data.cards ?? []).map((c) => [c.id, c])));
	const companionNameMap = $derived(new Map((data.companions ?? []).map((c) => [c.id, c.name])));
	function settlementName(id: 'owner' | number) {
		return id === 'owner' ? 'You' : (companionNameMap.get(id) ?? 'Unknown');
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

	function exportExpensesCsv() {
		const headers = ['Description', 'Amount', 'Currency', 'Category', 'Paid by', 'Date'];
		const rows = (data.expenses ?? []).map((e) => [
			e.description,
			(e.amount / 100).toFixed(2),
			e.currency,
			e.category,
			e.paidBy === 'owner' ? 'You' : companionNameMap.get(e.paidBy) ?? 'Unknown',
			e.createdAt ?? ''
		]);
		const csv = [headers, ...rows]
			.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
			.join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
			a.href = url;
			a.download = `expenses-${trip.id}.csv`;
			a.click();
		URL.revokeObjectURL(url);
	}

	function formatSegmentDuration(start: string | null | undefined, end: string | null | undefined) {
		if (!start || !end) return null;
		const s = DateTime.fromISO(start, { zone: 'utc' });
		const e = DateTime.fromISO(end, { zone: 'utc' });
		if (!s.isValid || !e.isValid) return null;
		const mins = Math.max(0, Math.round(e.diff(s, 'minutes').minutes));
		if (mins < 60) return `${mins}m`;
		const hours = Math.floor(mins / 60);
		const remMins = mins % 60;
		if (hours < 24) return remMins ? `${hours}h ${remMins}m` : `${hours}h`;
		const days = Math.floor(hours / 24);
		const remHours = hours % 24;
		return remHours ? `${days}d ${remHours}h` : `${days}d`;
	}

	function daysUntilStart(start: string | null | undefined) {
		if (!start) return null;
		const s = DateTime.fromISO(start).startOf('day');
		const now = DateTime.now().startOf('day');
		if (!s.isValid || s <= now) return null;
		return Math.ceil(s.diff(now, 'days').days);
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
	const baseCurrency = $derived(ownerTrip?.baseCurrency ?? (trip as typeof trips.$inferSelect).baseCurrency ?? 'USD');
	const segmentList = $derived(
		isEditor ? (data.segments as SegmentRow[]) : ((data.trip as { segments: SharedSegment[] }).segments as SegmentRow[])
	);

	function toggleSegmentId(id: number) {
		const next = new Set(selectedSegmentIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedSegmentIds = next;
	}

	const allSegmentsSelected = $derived(
		segmentList.length > 0 && segmentList.every((s) => s.id != null && selectedSegmentIds.has(s.id))
	);
	function setAllSegmentsSelected(value: boolean) {
		selectedSegmentIds = value
			? new Set(segmentList.map((s) => s.id).filter((id): id is number => id != null))
			: new Set();
	}
	const normalizedSegmentQuery = $derived(segmentQuery.trim().toLowerCase());
	const filteredSegmentList = $derived(
		segmentList.filter((s) => {
			if (selectedTypes.size > 0 && !selectedTypes.has(s.type as SegmentType)) return false;
			if (!normalizedSegmentQuery) return true;
			const hay = [s.title, s.location, s.confirmationNumber, s.meetingPoint]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			return hay.includes(normalizedSegmentQuery);
		})
	);
	const dayGroups = $derived(groupSegmentsByDay(filteredSegmentList));
	const days = $derived(tripDays(trip.startDate, trip.endDate));
	const daysUntil = $derived(daysUntilStart(trip.startDate));
	const status = $derived(tripStatus(trip.startDate, trip.endDate));
	const heroAccent = $derived(heroHue(trip.destination ?? trip.name));
	const typeCounts = $derived(
		SEGMENT_TYPES.map((type) => ({
			type,
			count: segmentList.filter((s) => s.type === type).length
		})).filter((t) => t.count > 0)
	);

	const EXPENSE_CATEGORIES = ['lodging', 'transport', 'food', 'activities', 'other'] as const;
	const categorySpending = $derived(
		EXPENSE_CATEGORIES.map((cat) => {
			const amount = (data.expenses ?? [])
				.filter((e) => e.category === cat)
				.reduce((sum, e) => sum + e.baseAmount, 0);
			return {
				category: cat,
				amount,
				label: cat.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())
			};
		})
			.filter((c) => c.amount > 0)
			.sort((a, b) => b.amount - a.amount)
	);
	const maxCategorySpend = $derived(Math.max(...categorySpending.map((c) => c.amount), 1));
</script>

<div class="trip-detail">
	<!-- Hero -->
	<section class="trip-hero">
		<div
			class="trip-hero-backdrop"
			style="background-image: linear-gradient(135deg, hsl({heroAccent} 45% 30% / 0.58) 0%, hsl({heroAccent} 40% 22% / 0.5) 42%, hsl({(heroAccent + 40) % 360} 35% 14%) 100%);"
		></div>
		<div class="trip-hero-scrim"></div>

		<div class="relative px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
			<a href="/trips" class="back-link">
				<Icon name="back" class="h-4 w-4" />
				Back to trips
			</a>

			<div class="flex flex-col gap-6 sm:flex-row sm:items-end">
				<div
					class="trip-poster grid place-items-center bg-gradient-to-br from-indigo-500/30 via-surface2 to-fuchsia-500/20"
					style="background-image: linear-gradient(145deg, hsl({heroAccent} 45% 28% / 0.5), hsl({(heroAccent + 50) % 360} 35% 16% / 0.8));"
				>
					<div class="text-center">
						<Icon name="location" class="mx-auto h-8 w-8 text-white/70" />
						<p class="mt-2 font-display text-2xl font-bold text-white">{posterInitials(trip.name, trip.destination)}</p>
					</div>
				</div>

				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						{#if !isEditor}
							<span class="badge badge-brand badge-compact">Shared view</span>
						{/if}
						<span class="badge badge-compact {tripStatusBadge(status).class}">{tripStatusBadge(status).label}</span>
						{#if ownerTrip}
							<span class="badge badge-compact {visibilityBadgeClass(ownerTrip.defaultVisibility)} capitalize">{ownerTrip.defaultVisibility}</span>
						{/if}
					</div>

					<h1 class="mt-2 text-3xl font-extrabold text-white sm:text-4xl">{trip.name}</h1>

					<div class="mt-3 flex flex-wrap gap-2">
						{#if trip.destination}
							<span class="trip-meta-pill">
								<Icon name="location" class="h-3.5 w-3.5 text-slate-500" />
								{trip.destination}
							</span>
						{/if}
						{#if trip.startDate || trip.endDate}
							<span class="trip-meta-pill">
								<span class="font-mono leading-none">{trip.startDate || '—'}</span>
								<Icon name="arrow-right" class="trip-meta-pill-arrow" />
								<span class="font-mono leading-none">{trip.endDate || '—'}</span>
							</span>
						{/if}
						{#if days}
							<span class="trip-meta-pill">{days} day{days === 1 ? '' : 's'}</span>
						{/if}
						{#if daysUntil != null}
							<span class="trip-meta-pill">Starts in {daysUntil} day{daysUntil === 1 ? '' : 's'}</span>
						{/if}
						<span class="trip-meta-pill">{segmentList.length} segment{segmentList.length === 1 ? '' : 's'}</span>
					</div>
				</div>

				<div class="flex justify-end sm:self-end">
					<details class="app-user-menu relative">
						<summary class="app-user-summary btn btn-primary flex cursor-pointer list-none items-center gap-2" aria-label="Trip actions">
							<Icon name="more-horizontal" class="h-4 w-4" />
							<span>Actions</span>
						</summary>
						<div class="app-user-menu-panel absolute right-0 top-[calc(100%+0.5rem)] z-30 w-64 overflow-hidden rounded-lg border shadow-2xl">
							<div class="p-2">
								<a href={`/trips/${trip.id}/calendar`} class="app-user-menu-item">
									<Icon name="calendar" class="h-4.5 w-4.5" />
									<span>Calendar</span>
								</a>
								<a href={`/trips/${trip.id}/print`} class="app-user-menu-item">
									<Icon name="print" class="h-4.5 w-4.5" />
									<span>Print</span>
								</a>
								{#if isEditor}
									<a href={`/trips/${trip.id}/edit`} class="app-user-menu-item">
										<Icon name="edit" class="h-4.5 w-4.5" />
										<span>Edit trip</span>
									</a>
									<form method="POST" action="?/duplicate">
										<button class="app-user-menu-item app-user-menu-button w-full" type="submit">
											<Icon name="duplicate" class="h-4.5 w-4.5" />
											<span>Duplicate</span>
										</button>
									</form>
									{#if data.owner === true}
										<form method="POST" action="?/toggleFavorite">
											<button class="app-user-menu-item app-user-menu-button w-full" type="submit">
												<Icon name="star" class="h-4.5 w-4.5" />
												<span>{trip.favorite ? 'Favorited' : 'Favorite'}</span>
											</button>
										</form>
										<form method="POST" action="?/toggleArchive">
											<button class="app-user-menu-item app-user-menu-button w-full" type="submit">
												<Icon name="archive" class="h-4.5 w-4.5" />
												<span>{trip.archived ? 'Unarchive' : 'Archive'}</span>
											</button>
										</form>
										<a href={`/trips/${trip.id}/share`} class="app-user-menu-item">
											<Icon name="share" class="h-4.5 w-4.5" />
											<span>Share</span>
										</a>
										{#if data.publicShareUrl}
											<CopyButton
												text={data.publicShareUrl}
												class="app-user-menu-item app-user-menu-button w-full"
												label="Copy public link"
												icon="copy"
											/>
										{/if}
									{/if}
								{/if}
							</div>
						</div>
					</details>
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
					<div class="flex flex-wrap items-center gap-2">
						<input
							type="text"
							class="input text-sm w-40"
							placeholder="Search segments…"
							bind:value={segmentQuery}
						/>
						{#if isEditor && segmentList.length}
							<form id="bulkDeleteForm" method="POST" action={`/trips/${trip.id}/segments?/deleteMany`} class="flex items-center gap-2">
								<label class="checkbox-label text-xs">
									<input
										type="checkbox"
										class="checkbox"
										checked={allSegmentsSelected}
										indeterminate={selectedSegmentIds.size > 0 && !allSegmentsSelected}
										onchange={(e) => setAllSegmentsSelected(e.currentTarget.checked)}
									/>
									Select all
								</label>
								{#if selectedSegmentIds.size}
									<button
										class="btn btn-ghost btn-ghost-danger btn-xs"
										type="submit"
										onclick={(e) => { if (!confirm(`Delete ${selectedSegmentIds.size} selected segment(s)?`)) e.preventDefault(); }}
									>
										Delete {selectedSegmentIds.size}
									</button>
								{/if}
							</form>
						{/if}
						{#if isEditor}
							<a href={`/trips/${trip.id}/segments/new`} class="btn btn-primary">
								<Icon name="plus" class="h-4 w-4" />
								Add segment
							</a>
						{/if}
					</div>
				</div>

				{#if dayGroups.length}
					<div class="trip-timeline-groups space-y-8">
						{#each dayGroups as group (group.key)}
							<div>
								<div class="trip-timeline-day">
									<span class="subsection-title">{group.label}</span>
									<span class="text-[0.938rem] text-slate-500">{group.segments.length} item{group.segments.length === 1 ? '' : 's'}</span>
								</div>

								<div class="trip-timeline-track space-y-3">
									{#each group.segments as s, i (s.id ?? `${group.key}-${i}`)}
										{@const duration = formatSegmentDuration(s.startAt, s.endAt)}
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
														<input id={`endAt-${s.id}`} name="endAt" type="datetime-local" value={toDatetimeLocal(s.endAt, s.endTz ?? s.startTz)} class="input {form?.errors?.endAt ? 'input-error' : ''}" />
														{#if form?.errors?.endAt}<p class="field-error">{form.errors.endAt}</p>{/if}
													</div>
													<div class="field">
														<label class="label" for={`endTz-${s.id}`}>End timezone</label>
													<TimezoneSelect id={`endTz-${s.id}`} name="endTz" value={s.endTz ?? s.startTz} class="input {form?.errors?.endTz ? 'input-error' : ''}" />
													{#if form?.errors?.endTz}<p class="field-error">{form.errors.endTz}</p>{/if}
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
														<label class="label" for={`meetingPoint-${s.id}`}>Meeting / rally point</label>
														<input id={`meetingPoint-${s.id}`} name="meetingPoint" value={s.meetingPoint ?? ''} maxlength="200" class="input {form?.errors?.meetingPoint ? 'input-error' : ''}" />
														{#if form?.errors?.meetingPoint}<p class="field-error">{form.errors.meetingPoint}</p>{/if}
													</div>
													<div class="field">
														<label class="label" for={`meetingAt-${s.id}`}>Rally time</label>
														<input id={`meetingAt-${s.id}`} name="meetingAt" type="datetime-local" value={toDatetimeLocal(s.meetingAt, s.startTz ?? 'UTC')} class="input {form?.errors?.meetingAt ? 'input-error' : ''}" />
														{#if form?.errors?.meetingAt}<p class="field-error">{form.errors.meetingAt}</p>{/if}
													</div>
													<div class="field sm:col-span-2">
													<div class="field">
														<label class="label" for={`paymentStatus-${s.id}`}>Payment status</label>
														<select id={`paymentStatus-${s.id}`} name="paymentStatus" class="input {form?.errors?.paymentStatus ? 'input-error' : ''}">
															<option value="quoted" selected={s.paymentStatus === 'quoted'}>Quoted</option>
															<option value="deposit_paid" selected={s.paymentStatus === 'deposit_paid'}>Deposit paid</option>
															<option value="fully_paid" selected={s.paymentStatus === 'fully_paid'}>Fully paid</option>
															<option value="refunded" selected={s.paymentStatus === 'refunded'}>Refunded</option>
														</select>
														{#if form?.errors?.paymentStatus}<p class="field-error">{form.errors.paymentStatus}</p>{/if}
													</div>
													<div class="field">
														<label class="label" for={`paymentDueDate-${s.id}`}>Payment due</label>
														<input id={`paymentDueDate-${s.id}`} name="paymentDueDate" type="date" value={s.paymentDueDate ?? ''} class="input {form?.errors?.paymentDueDate ? 'input-error' : ''}" />
														{#if form?.errors?.paymentDueDate}<p class="field-error">{form.errors.paymentDueDate}</p>{/if}
													</div>
														<label class="label" for={`detailsJson-${s.id}`}>Details (JSON)</label>
														<textarea id={`detailsJson-${s.id}`} name="detailsJson" class="input h-20 font-mono text-xs {form?.errors?.detailsJson ? 'input-error' : ''}">{s.detailsJson ?? ''}</textarea>
														{#if form?.errors?.detailsJson}<p class="field-error">{form.errors.detailsJson}</p>{/if}
													</div>
												{#if data.cards?.length}
													<CardSelect cards={data.cards} name="cardId" value={s.cardId} errors={form?.errors} />
												{/if}

													<div class="flex gap-2 sm:col-span-2">
														<button type="button" class="btn btn-ghost" onclick={() => (editingId = null)}>Cancel</button>
														<button class="btn btn-primary">Save</button>
													</div>
												</form>
											{:else}
												<article class="trip-timeline-card">
													<div class="flex flex-col gap-3 lg:flex-row lg:items-start">
														{#if s.startAt}
															<div class="w-16 shrink-0 pt-0.5 text-right font-mono text-xs text-indigo-300/90">
																{formatTime(s.startAt, s.startTz ?? 'UTC')}
															</div>
														{/if}
														<div class="min-w-0 flex-1">
															<div class="flex flex-wrap items-center gap-2">
																{#if isEditor && s.id}
																	<input
																		type="checkbox"
																		name="segmentId"
																		value={s.id}
																		form="bulkDeleteForm"
																		class="checkbox"
																		checked={selectedSegmentIds.has(s.id!)}
																		onchange={() => toggleSegmentId(s.id!)}
																	/>
																{/if}
																<span class="badge badge-slate">{SEG[s.type as keyof typeof SEG]?.label ?? s.type}</span>
																<h3 class="font-semibold text-white">{s.title}</h3>
																{#if isEditor && s.id}
																	<form method="POST" action="?/setSegmentStatus" class="contents">
																		<input type="hidden" name="segmentId" value={s.id} />
																		<select
																			name="status"
																			class="input input-xs w-auto"
																			onchange={(e) => e.currentTarget.form?.requestSubmit()}
																		>
																			{#each SEGMENT_STATUSES as st}
																				<option value={st} selected={s.status === st}>{segmentStatusLabel(st)}</option>
																			{/each}
																		</select>
																	</form>
																{:else if s.status}
																	<span class="badge badge-compact {segmentStatusClass(s.status)}">{segmentStatusLabel(s.status)}</span>
																{/if}
													{#if s.paymentStatus && s.paymentStatus !== 'quoted'}
														<span class="badge badge-compact badge-slate capitalize">{s.paymentStatus.replace('_', ' ')}</span>
													{/if}
															</div>
															{#if s.endAt}
																<p class="mt-1 font-mono text-xs text-slate-500">
																	Until {formatTime(s.endAt, s.endTz ?? s.startTz ?? 'UTC')}
																	{#if duration}<span class="ml-1.5 text-slate-600">· {duration}</span>{/if}
																</p>
															{/if}
															{#if s.location}
																<p class="mt-1.5 text-sm text-slate-400">{s.location}</p>
															{/if}
															{#if isEditor && s.confirmationNumber}
																<p class="mt-1 font-mono text-xs text-slate-500">Confirmation {s.confirmationNumber}</p>
															{/if}
															{#if s.meetingPoint || s.meetingAt}
																<p class="mt-1.5 text-sm text-indigo-300/90">
																	<Icon name="location" class="inline h-3.5 w-3.5 mr-1" />
																	{#if s.meetingPoint}<span class="font-medium">{s.meetingPoint}</span>{/if}
																	{#if s.meetingPoint && s.meetingAt}<span class="mx-1 text-slate-500">·</span>{/if}
																	{#if s.meetingAt}Meet at {formatTime(s.meetingAt, s.startTz ?? 'UTC')}{/if}
																</p>
															{/if}
												{#if s.cardId}
													{@const c = cardMap.get(s.cardId)}
													{#if c}
														<p class="mt-1 text-xs text-slate-400">
															<Icon name="card" class="inline h-3.5 w-3.5 mr-1" />
															{c.nickname}{#if c.network || c.last4} — {c.network}{c.last4 ? ` ····${c.last4}` : ''}{/if}
														</p>
													{/if}
												{/if}
															{#if !isEditor && s.detailsJson}
																<div class="subpanel-compact mt-2">
																	<pre class="whitespace-pre-wrap font-mono text-[10px] text-slate-400">{s.detailsJson}</pre>
																</div>
															{/if}
														</div>
												{#if data.companions?.length && s.id}
													{@const attendees = data.attendeesBySegment?.get(s.id) ?? []}
													{#if attendees.length}
														<div class="mt-2 flex flex-wrap gap-1.5">
															{#each attendees as a (a.id)}
																<span class="badge badge-compact {a.status === 'going' ? 'badge-green' : a.status === 'maybe' ? 'badge-amber' : 'badge-slate'} capitalize">
																	{a.name}
																	{#if a.status === 'maybe'}?{:else if a.status === 'not_going'}×{/if}
																</span>
															{/each}
														</div>
													{/if}
												{/if}
																												{#if isEditor && s.id}
																<div class="flex w-full flex-wrap items-center gap-1 lg:w-auto lg:shrink-0 lg:justify-end">
																<button type="button" class="btn btn-ghost btn-ghost-muted" onclick={() => (editingId = s.id ?? null)}>Edit</button>
													<form method="POST" action="?/duplicateSegment">
														<input type="hidden" name="segmentId" value={s.id} />
														<button class="btn btn-ghost btn-ghost-muted">Duplicate</button>
													</form>
																<form method="POST" action={`/trips/${trip.id}/segments?/delete`}>
																	<input type="hidden" name="segmentId" value={s.id} />
																	<button class="btn btn-ghost btn-ghost-danger">Delete</button>
																</form>
																<form method="POST" action={`/trips/${trip.id}?/segmentReminder`} class="flex items-center gap-1">
																	<input type="hidden" name="segmentId" value={s.id} />
																	<select name="offsetMinutes" class="input text-sm w-auto">
																		{#each REMINDER_OFFSETS.filter((o) => o.minutes <= 1440) as offset}
																			<option value={offset.minutes}>{offset.shortLabel}</option>
																		{/each}
																	</select>
																	<button class="btn btn-ghost btn-sm">Remind</button>
																</form>
																{#if data.providers?.length}
																	<form method="POST" action={`/trips/${trip.id}/fare-watch?/enable`} class="flex items-center gap-1">
																		<input type="hidden" name="segmentId" value={s.id} />
																		<select name="providerId" class="select select-compact w-auto">
																		{#each data.providers as p (p.id)}
																			<option value={p.id}>{p.label || p.providerKey}</option>
																		{/each}
																		</select>
																		<button class="btn btn-ghost btn-sm">Watch</button>
																	</form>
																{/if}
														{#if data.companions?.length}
															<div class="flex flex-wrap items-center gap-1">
																{#each data.companions as comp (comp.id)}
																	{@const current = data.attendeesBySegment?.get(s.id ?? 0)?.find((a) => a.companionId === comp.id)?.status ?? 'not_invited'}
																	<form method="POST" action="?/setAttendee" class="flex items-center gap-1">
																		<input type="hidden" name="segmentId" value={s.id} />
																		<input type="hidden" name="companionId" value={comp.id} />
																		<select name="status" class="input input-xs w-auto" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
																			<option value="not_invited" selected={current === 'not_invited'}>{comp.name}</option>
																			<option value="going" selected={current === 'going'}>{comp.name} ✓</option>
																			<option value="maybe" selected={current === 'maybe'}>{comp.name} ?</option>
																			<option value="not_going" selected={current === 'not_going'}>{comp.name} ×</option>
																		</select>
																	</form>
																{/each}
															</div>
														{/if}
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
					<div class="empty-state mt-0">
						<div class="empty-icon">
							<Icon name="flight" class="h-6 w-6" />
						</div>
						<p class="text-slate-300">
							{#if selectedTypes.size > 0 || segmentQuery.trim()}
								No segments match your filters.
							{:else}
								{isEditor ? 'No segments yet — add your first flight, stay, or activity.' : 'No itinerary shared.'}
							{/if}
						</p>
						{#if isEditor}
							<a href={`/trips/${trip.id}/segments/new`} class="btn btn-primary">Add segment</a>
						{/if}
					</div>
				{/if}
			</section>

			{#if data.checklist?.items?.length || isEditor}
				<section class="card p-5">
					<div class="panel-header">
						<h2 class="section-title">Packing checklist</h2>
						<div class="flex items-center gap-2">
							{#if isEditor && data.checklist?.items?.length}
								<form method="POST" action="?/setAllChecklistItems">
									<input type="hidden" name="packed" value="true" />
									<button class="btn btn-ghost btn-xs" type="submit">Pack all</button>
								</form>
								<form method="POST" action="?/setAllChecklistItems">
									<input type="hidden" name="packed" value="false" />
									<button class="btn btn-ghost btn-xs" type="submit">Unpack all</button>
								</form>
							{/if}
							{#if data.checklist?.items?.length}
								{@const packed = data.checklist.items.filter((i) => i.packed).length}
								<span class="font-mono text-xs text-slate-500">{packed}/{data.checklist.items.length}</span>
							{/if}
						</div>
					</div>
					{#if data.checklist?.items?.length}
						<ul class="space-y-2">
							{#each data.checklist.items as item (item.id)}
								<li class="list-item-compact flex items-center justify-between gap-3">
									<form method="POST" action="?/toggleChecklistItem" class="flex items-center gap-3">
										<input type="hidden" name="itemId" value={item.id} />
										<button type="submit" class="check-toggle">
											<span class="check-marker {item.packed ? 'check-marker-active' : ''}">
												{#if item.packed}<Icon name="check" class="h-3.5 w-3.5" />{/if}
											</span>
											<span class="check-label {item.packed ? 'check-label-done' : ''}">{item.text}</span>
										</button>
									</form>
									<div class="flex items-center gap-2">
										{#if item.assignedToName}<span class="text-xs text-slate-500">{item.assignedToName}</span>{/if}
										{#if isEditor}
											<form method="POST" action="?/deleteChecklistItem">
												<input type="hidden" name="itemId" value={item.id} />
												<button class="icon-button icon-button-sm" aria-label="Delete item">
													<Icon name="close" class="h-3.5 w-3.5" />
												</button>
											</form>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="empty-text py-2">No checklist items yet.</p>
					{/if}
					{#if isEditor}
						<form method="POST" action="?/addChecklistItem" class="mt-4 flex flex-wrap items-end gap-2">
							<input name="text" class="input text-sm min-w-0 flex-1" placeholder="Add an item..." required />
							<select name="assignedToCompanionId" class="input text-sm w-auto">
								<option value="">Unassigned</option>
								{#each data.companions ?? [] as c (c.id)}
									<option value={c.id}>{c.name}</option>
								{/each}
							</select>
							<button class="btn btn-primary btn-sm">Add</button>
						</form>
					{/if}
					{#if data.owner === true && data.checklist?.items?.length}
						<form method="POST" action="?/saveChecklistTemplate" class="mt-4 flex flex-wrap items-end gap-2 border-t border-white/5 pt-4">
							<input name="name" class="input min-w-0 flex-1 text-sm" placeholder="Template name" required maxlength="100" />
							<input type="hidden" name="fromTripId" value={trip.id} />
							<button class="btn btn-ghost btn-sm">Save template</button>
						</form>
					{/if}
					{#if data.packingTemplates?.length}
						<form method="POST" action="?/applyChecklistTemplate" class="mt-3 flex flex-wrap items-end gap-2">
							<select name="templateId" class="select select-compact min-w-0 flex-1" required>
								<option value="" disabled selected>Apply a template</option>
								{#each data.packingTemplates as tmpl (tmpl.id)}
									<option value={tmpl.id}>{tmpl.name} ({tmpl.items.length})</option>
								{/each}
							</select>
							<button class="btn btn-primary btn-sm">Apply</button>
						</form>
					{/if}
				</section>
			{/if}

			{#if data.expenses?.length || isEditor}
				<section class="card p-5">
					<div class="panel-header">
						<h2 class="section-title">Expenses</h2>
						<div class="flex flex-wrap items-center gap-2">
							{#if data.expenses?.length}
								<button class="btn btn-ghost btn-xs" type="button" onclick={exportExpensesCsv}>Export CSV</button>
							{/if}
							{#if Object.keys(data.expenseSummary?.totalsByCurrency ?? {}).length}
								<div class="flex flex-wrap gap-2">
								{#each Object.entries(data.expenseSummary.totalsByCurrency) as [currency, amount]}
									<span class="badge badge-slate badge-compact font-mono">{currency} {(amount / 100).toFixed(2)}</span>
									{#if data.expenseSummary.baseTotal}
										<span class="badge badge-compact badge-brand font-mono">{data.expenseSummary.baseTotal.currency} {(data.expenseSummary.baseTotal.amount / 100).toFixed(2)}</span>
									{/if}
								{/each}
							</div>
						{/if}
					</div>
				</div>

					{#if categorySpending.length}
						<div class="mt-4 space-y-2">
							<h3 class="subsection-title">Spending by category</h3>
							{#each categorySpending as c (c.category)}
								<div class="flex items-center gap-3 text-sm">
									<span class="w-20 shrink-0 text-slate-300">{c.label}</span>
									<div class="h-3 flex-1 rounded-full bg-surface2">
										<div
											class="h-3 rounded-full bg-indigo-500/80"
											style="width: {Math.round((c.amount / maxCategorySpend) * 100)}%;"
										></div>
									</div>
									<span class="w-24 shrink-0 text-right font-mono text-xs text-slate-400">
										{formatCents(c.amount, baseCurrency)}
									</span>
								</div>
							{/each}
						</div>
					{/if}

					{#if data.expenses?.length}
						<ul class="space-y-2">
							{#each data.expenses as e (e.id)}
								<li class="list-item-compact flex items-center justify-between gap-3">
									<div class="min-w-0">
										<p class="text-sm font-medium text-slate-200">{e.description}</p>
										<p class="text-xs text-slate-500">
											Paid by {e.paidBy === 'owner' ? 'you' : data.companions?.find((c) => c.id === e.paidBy)?.name ?? 'unknown'}
											{#if e.splitAmong.length}> · Split {e.splitAmong.length} way{e.splitAmong.length === 1 ? '' : 's'}{/if}
										</p>
										{#if e.attachments?.length}
											<div class="mt-1 flex flex-wrap items-center gap-2">
												<Icon name="attachment" class="h-3.5 w-3.5 text-slate-500" />
												{#each e.attachments as a (a.id)}
													<a href="/trips/{trip.id}/expenses/{e.id}/attachments/{a.id}" target="_blank" class="link text-xs no-underline hover:underline">{a.filename}</a>
												{/each}
											</div>
										{/if}
									</div>
									<div class="flex items-center gap-2">
										<span class="font-mono text-sm text-slate-200">{e.currency} {(e.amount / 100).toFixed(2)}</span>
										{#if isEditor}
											<form method="POST" action="?/deleteExpense">
												<input type="hidden" name="expenseId" value={e.id} />
												<button class="icon-button icon-button-sm" aria-label="Delete expense">
													<Icon name="close" class="h-3.5 w-3.5" />
												</button>
											</form>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="empty-text py-2">No expenses recorded yet.</p>
					{/if}
					{#if isEditor}
						<form method="POST" action="?/addExpense" class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end">
							<input name="description" class="input text-sm" placeholder="Description" required />
							<input name="amount" type="number" min="1" step="1" class="input w-32 text-sm" placeholder="Cents" required />
							<input name="currency" class="input w-24 text-sm" placeholder="USD" value="USD" required />
							<input name="exchangeRate" type="number" min="0.0001" step="0.0001" class="input w-28 text-sm" placeholder="Rate" title="Exchange rate to trip base currency" />
								<select name="category" class="input w-auto text-sm">
									<option value="lodging">Lodging</option>
									<option value="transport">Transport</option>
									<option value="food">Food</option>
									<option value="activities">Activities</option>
									<option value="other" selected>Other</option>
								</select>
							<select name="paidByCompanionId" class="input w-auto text-sm">
								<option value="">You</option>
								{#each data.companions ?? [] as c (c.id)}
									<option value={c.id}>{c.name}</option>
								{/each}
							</select>
							<div class="sm:col-span-5">
								<p class="mb-1 text-xs text-slate-400">Split among</p>
								<div class="flex flex-wrap gap-2">
									<label class="checkbox-label text-xs">
										<input type="checkbox" name="splitAmong" value="owner" class="checkbox" /> You
									</label>
									{#each data.companions ?? [] as c (c.id)}
										<label class="checkbox-label text-xs">
											<input type="checkbox" name="splitAmong" value={c.id} class="checkbox" /> {c.name}
										</label>
									{/each}
								</div>
							</div>
							<button class="btn btn-primary btn-sm sm:col-span-5">Add expense</button>
						</form>
							{#if data.expenses?.length}
								<form method="POST" action="?/addAttachment" enctype="multipart/form-data" class="mt-3 flex flex-wrap items-end gap-2">
									<input type="hidden" name="expenseId" value={data.expenses[0].id} />
									<span class="text-xs text-slate-400">Attach receipt to first expense</span>
									<input type="file" name="file" accept="image/*,application/pdf" class="input text-sm w-auto" required />
									<button class="btn btn-ghost btn-sm">Upload</button>
								</form>
							{/if}
					{/if}

					{#if data.expenseSettlement && Object.keys(data.expenseSettlement).length}
						<div class="mt-5 space-y-4">
							<h3 class="subsection-title">Settlement</h3>
							{#each Object.entries(data.expenseSettlement) as [currency, settlement]}
								<div class="subpanel">
									<div class="mb-2 flex items-center justify-between">
										<span class="font-mono text-xs text-slate-400">{currency}</span>
									</div>
									<div class="grid gap-4 sm:grid-cols-2">
										<div>
											<h4 class="mb-1 text-xs font-medium text-slate-400">Balances</h4>
											<ul class="space-y-1">
												{#each settlement.balances.filter((b) => b.net !== 0) as b (b.companionId)}
													<li class="text-sm {b.net > 0 ? 'text-emerald-300' : 'text-rose-300'}">
														{settlementName(b.companionId)}: {b.net > 0 ? '+' : ''}{(b.net / 100).toFixed(2)}
													</li>
												{/each}
											</ul>
										</div>
										{#if settlement.payments.length}
											<div>
												<h4 class="mb-1 text-xs font-medium text-slate-400">Suggested payments</h4>
												<ul class="space-y-1">
													{#each settlement.payments as p (`${p.from}-${p.to}-${p.amount}`)}
														<li class="text-sm text-slate-200">
															{settlementName(p.from)} pays {settlementName(p.to)} {currency} {(p.amount / 100).toFixed(2)}
														</li>
													{/each}
												</ul>
											</div>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{/if}

			{#if isEditor || data.budgets?.some((b) => b.amount != null)}
				<section class="card p-5">
					<div class="panel-header">
						<h2 class="section-title">
							<Icon name="budget" class="inline h-4 w-4 mr-1.5" />
							Budget
						</h2>
					</div>
					<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{#each data.budgets.filter((b) => isEditor || b.amount != null) as budget (budget.category)}
							{@const percent = budget.amount != null && budget.amount > 0 ? Math.min(100, Math.round((budget.spent / budget.amount) * 100)) : 0}
							<div class="list-item-compact flex min-h-28 flex-col justify-between gap-3">
								<div class="flex items-center justify-between gap-3">
									<span class="font-medium text-slate-200 capitalize">{budget.category}</span>
									{#if budget.amount != null}
										<div class="flex items-center gap-2">
											<span class="badge badge-compact {budget.alert === 'over' ? 'badge-red' : budget.alert === 'near' ? 'badge-amber' : 'badge-green'}">{budget.alert}</span>
											{#if isEditor}
												<form method="POST" action="?/deleteBudget">
													<input type="hidden" name="category" value={budget.category} />
													<button class="icon-button icon-button-sm" aria-label="Remove budget">
														<Icon name="close" class="h-3.5 w-3.5" />
													</button>
												</form>
											{/if}
										</div>
									{/if}
								</div>
								{#if budget.amount != null}
									<div>
										<div class="mb-1 flex items-center justify-between text-xs text-slate-400">
											<span>Spent {formatCents(budget.spent, budget.currency)} / {formatCents(budget.amount, budget.currency)}</span>
											<span>{budget.remaining != null ? `${formatCents(budget.remaining, budget.currency)} remaining` : ''}</span>
										</div>
										<div class="progress-track">
											<div
												class="progress-fill {budget.alert === 'over' ? 'bg-red-500' : budget.alert === 'near' ? 'bg-amber-500' : ''}"
												style="width: {percent}%;"
											></div>
										</div>
									</div>
								{:else if isEditor}
									<form method="POST" action="?/setBudget" class="flex flex-wrap items-center gap-2">
										<input type="hidden" name="category" value={budget.category} />
										<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" class="input input-compact w-28" placeholder="Amount" required />
										<span class="badge badge-slate badge-compact font-mono">{budget.currency}</span>
										<button class="btn btn-primary btn-sm">Set cap</button>
									</form>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if data.journalEntries?.length || isEditor}
				<section class="card p-5">
					<div class="panel-header">
						<h2 class="section-title">Journal</h2>
					</div>
					{#if data.journalEntries?.length}
						<ul class="space-y-4">
							{#each data.journalEntries as entry (entry.id)}
								<li class="list-item-compact">
									<div class="flex items-center justify-between gap-2">
										<span class="font-semibold text-slate-200">{entry.title}</span>
										<span class="font-mono text-xs text-slate-500">{entry.entryDate}</span>
									</div>
									<p class="mt-1 whitespace-pre-wrap text-sm text-slate-300">{entry.body}</p>
									{#if isEditor}
										<form method="POST" action="?/deleteJournalEntry" class="mt-2">
											<input type="hidden" name="entryId" value={entry.id} />
											<button class="btn btn-ghost btn-ghost-danger btn-xs">Delete</button>
										</form>
									{/if}
								</li>
							{/each}
						</ul>
					{:else}
						<p class="empty-text py-2">No journal entries yet.</p>
					{/if}
					{#if isEditor}
						<form method="POST" action="?/addJournalEntry" class="mt-4 grid gap-2">
							<input name="title" class="input text-sm" placeholder="Title" required />
							<input name="entryDate" type="date" class="input w-auto text-sm" required />
							<textarea name="body" rows="3" class="input text-sm" placeholder="Write about your day..." required></textarea>
							<button class="btn btn-primary btn-sm">Add journal entry</button>
						</form>
					{/if}
				</section>
			{/if}

			{#if data.polls?.length || isEditor}
				<section class="card p-5">
					<div class="panel-header">
						<h2 class="section-title">
							<Icon name="poll" class="inline h-4 w-4 mr-1.5" />
							Polls
						</h2>
						{#if data.polls?.length}
							<span class="font-mono text-xs text-slate-500">{data.polls.length}</span>
						{/if}
					</div>

					{#if data.polls?.length}
						<div class="space-y-4">
							{#each data.polls as poll (poll.id)}
								{@const selectedCompanion = selectedCompanionByPoll[poll.id] ?? ''}
								{@const currentVote = selectedCompanion
									? poll.votes.find((v) => v.companionId === Number(selectedCompanion))
									: undefined}
								<div class="subpanel">
									<div class="flex items-start justify-between gap-3">
										<h3 class="subsection-title">{poll.question}</h3>
										{#if isEditor}
											<form method="POST" action="?/deletePoll">
												<input type="hidden" name="pollId" value={poll.id} />
												<button class="icon-button icon-button-sm" aria-label="Delete poll">
													<Icon name="close" class="h-3.5 w-3.5" />
												</button>
											</form>
										{/if}
									</div>

									{#if isEditor}
										<form method="POST" action="?/votePoll" class="mt-3 space-y-2">
											<input type="hidden" name="pollId" value={poll.id} />
											<select
												name="companionId"
												class="input text-sm"
												bind:value={selectedCompanionByPoll[poll.id]}
												required
											>
												<option value="">Vote as companion...</option>
												{#each data.companions ?? [] as c (c.id)}
													<option value={c.id}>{c.name}</option>
												{/each}
											</select>
											<div class="flex flex-wrap gap-2">
												{#each poll.options as opt (opt.id)}
													{@const isSelected = currentVote?.optionId === opt.id}
													<button
														name="optionId"
														value={opt.id}
														class="btn btn-sm {isSelected ? 'btn-primary' : 'btn-ghost'}"
														disabled={!selectedCompanion}
													>
														{opt.label}
														<span class="ml-1.5 font-mono text-xs opacity-80">{opt.voteCount}</span>
													</button>
												{/each}
											</div>
										</form>
									{:else}
										<ul class="mt-2 space-y-1">
											{#each poll.options as opt (opt.id)}
												<li class="flex items-center justify-between text-sm">
													<span class="text-slate-200">{opt.label}</span>
													<span class="badge badge-slate badge-compact font-mono">{opt.voteCount}</span>
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<p class="empty-text py-2">No polls yet.</p>
					{/if}

					{#if isEditor}
						<form method="POST" action="?/createPoll" class="mt-4 space-y-2">
							<input
								name="question"
								class="input text-sm"
								placeholder="Ask a question..."
								required
								maxlength="500"
							/>
							<div class="space-y-1">
								{#each [0, 1, 2] as i}
									<input
										name="options"
										class="input text-sm"
										placeholder="Option {i + 1}"
									/>
								{/each}
							</div>
							<button class="btn btn-primary btn-sm">Create poll</button>
						</form>
					{/if}
				</section>
			{/if}

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
						<ul class="list-stack">
							{#each data.watches as w (w.id)}
								{@const last = w.lastResultJson ? JSON.parse(w.lastResultJson) : null}
								<li class="list-item flex items-center gap-3">
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-2">
											<span class="badge badge-slate">{w.label || w.providerKey}</span>
										{#if w.segmentTitle}<span class="badge badge-slate">{w.segmentTitle}</span>{/if}
											<span class="badge {w.status === 'active' ? 'badge-brand' : 'badge-slate'}">{w.status}</span>
										</div>
										{#if last?.summary}
											<p class="mt-1 text-xs text-slate-400">{last.summary}</p>
										{/if}
										{#if w.lastCheckedAt}
											<p class="mt-0.5 text-xs text-slate-500">Last checked: {formatDateTime(w.lastCheckedAt, { timeZone: 'UTC' })}</p>
										{/if}
									</div>
									<div class="action-row gap-1">
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
						<p class="empty-text py-4">No fare watches enabled for this trip.</p>
					{/if}
				</section>
			{/if}

			{#if isEditor && data.owner === true}
				<section class="card p-5">
					<h2 class="section-title mb-3">Save as template</h2>
					<form method="POST" action="?/saveTripTemplate" class="flex flex-wrap items-end gap-2">
						<input name="name" class="input text-sm min-w-0 flex-1" placeholder="Template name" required maxlength="100" />
						<button class="btn btn-primary btn-sm">Save template</button>
					</form>
				</section>
			{/if}

			{#if data.homeTasks?.length || isEditor}
				<section class="card p-5">
					<div class="panel-header">
						<h2 class="section-title">Home prep</h2>
						{#if data.homeTasks?.length}<span class="font-mono text-xs text-slate-500">{data.homeTasks.filter((t) => t.done).length}/{data.homeTasks.length}</span>{/if}
					</div>
				{#if data.homeTasks?.length}
					<ul class="space-y-2">
						{#each data.homeTasks as task (task.id)}
							<li class="list-item-compact flex items-center justify-between gap-3">
								<form method="POST" action="?/toggleHomeTask" class="flex items-center gap-3">
									<input type="hidden" name="taskId" value={task.id} />
									<button type="submit" class="check-toggle">
										<span class="check-marker {task.done ? 'check-marker-active' : ''}">
											{#if task.done}<Icon name="check" class="h-3.5 w-3.5" />{/if}
										</span>
										<span class="check-label {task.done ? 'check-label-done' : ''}">{task.text}</span>
									</button>
								</form>
								<div class="flex items-center gap-2">
									{#if task.dueDate}<span class="text-xs text-slate-500">{task.dueDate}</span>{/if}
									{#if isEditor}
										<form method="POST" action="?/deleteHomeTask">
											<input type="hidden" name="taskId" value={task.id} />
											<button class="icon-button icon-button-sm" aria-label="Delete task"><Icon name="close" class="h-3.5 w-3.5" /></button>
										</form>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="empty-text py-2">No home-prep tasks yet.</p>
				{/if}
				{#if isEditor}
					<form method="POST" action="?/addHomeTask" class="mt-4 flex flex-wrap items-end gap-2">
						<input name="text" class="input min-w-0 flex-1 text-sm" placeholder="Add a task…" required />
						<input name="dueDate" type="date" class="input w-auto text-sm" />
						<button class="btn btn-primary btn-sm">Add</button>
					</form>
				{/if}
				</section>
			{/if}

			{#if data.medications?.length || isEditor}
				<section class="card p-5">
					<h2 class="section-title mb-3">Medications</h2>
				{#if data.medications?.length}
					<ul class="space-y-2">
						{#each data.medications as med (med.id)}
							<li class="list-item-compact">
								<div class="flex items-center justify-between gap-2">
									<span class="font-medium text-slate-200">{med.name}</span>
									{#if isEditor}
										<form method="POST" action="?/deleteMedication">
											<input type="hidden" name="medicationId" value={med.id} />
											<button class="icon-button icon-button-sm" aria-label="Delete medication"><Icon name="close" class="h-3.5 w-3.5" /></button>
										</form>
									{/if}
								</div>
								{#if med.companionName}<p class="text-xs text-slate-500">For {med.companionName}</p>{/if}
								{#if med.dosage || med.schedule}<p class="text-xs text-slate-400">{med.dosage}{#if med.dosage && med.schedule} · {/if}{med.schedule}</p>{/if}
								{#if med.notes}<p class="text-xs text-slate-500">{med.notes}</p>{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="empty-text py-2">No medications recorded.</p>
				{/if}
				{#if isEditor}
					<form method="POST" action="?/addMedication" class="mt-4 grid gap-2 sm:grid-cols-2">
						<input name="name" class="input text-sm" placeholder="Name" required />
						<select name="companionId" class="input text-sm">
							<option value="">For anyone</option>
							{#each data.companions ?? [] as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
						</select>
						<input name="dosage" class="input text-sm" placeholder="Dosage" />
						<input name="schedule" class="input text-sm" placeholder="Schedule" />
						<input name="startsAt" type="datetime-local" class="input text-sm" placeholder="Starts" />
						<input name="endsAt" type="datetime-local" class="input text-sm" placeholder="Ends" />
						<textarea name="notes" class="input text-sm sm:col-span-2" placeholder="Notes" rows="2"></textarea>
						<button class="btn btn-primary btn-sm sm:col-span-2">Add medication</button>
					</form>
				{/if}
				</section>
			{/if}

			{#if data.entryRequirements?.length || isEditor}
				<section class="card p-5">
					<h2 class="section-title mb-3">Entry requirements</h2>
				{#if data.entryRequirements?.length}
					<ul class="space-y-2">
						{#each data.entryRequirements as req (req.id)}
							<li class="list-item-compact flex items-center justify-between gap-3">
								<div>
									<p class="text-sm font-medium text-slate-200">{req.country} — <span class="capitalize">{req.requirementType}</span></p>
									{#if req.dueDate}<p class="text-xs text-slate-500">Due {req.dueDate}</p>{/if}
									{#if req.notes}<p class="text-xs text-slate-500">{req.notes}</p>{/if}
								</div>
								<div class="flex items-center gap-2">
									{#if isEditor}
										<form method="POST" action="?/updateEntryRequirementStatus" class="flex items-center gap-1">
											<input type="hidden" name="requirementId" value={req.id} />
											<select name="status" class="input input-compact w-auto" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
												<option value="needed" selected={req.status === 'needed'}>Needed</option>
												<option value="in_progress" selected={req.status === 'in_progress'}>In progress</option>
												<option value="complete" selected={req.status === 'complete'}>Complete</option>
												<option value="not_needed" selected={req.status === 'not_needed'}>Not needed</option>
											</select>
										</form>
										<form method="POST" action="?/deleteEntryRequirement">
											<input type="hidden" name="requirementId" value={req.id} />
											<button class="icon-button icon-button-sm" aria-label="Delete requirement"><Icon name="close" class="h-3.5 w-3.5" /></button>
										</form>
									{:else}
										<span class="badge badge-compact badge-slate capitalize">{req.status.replace('_', ' ')}</span>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="empty-text py-2">No entry requirements recorded.</p>
				{/if}
				{#if isEditor}
					<form method="POST" action="?/addEntryRequirement" class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
						<input name="country" class="input text-sm" placeholder="Country" required />
						<select name="requirementType" class="input text-sm">
							<option value="visa">Visa</option>
							<option value="vaccination">Vaccination</option>
							<option value="other">Other</option>
						</select>
						<input name="dueDate" type="date" class="input text-sm" />
						<input name="notes" class="input text-sm sm:col-span-3" placeholder="Notes" />
						<button class="btn btn-primary btn-sm sm:col-span-3">Add requirement</button>
					</form>
				{/if}
				</section>
			{/if}

			{#if data.importantItems?.length || isEditor}
				<section class="card p-5">
					<h2 class="section-title mb-3">Important items</h2>
				{#if data.importantItems?.length}
					<ul class="space-y-2">
						{#each data.importantItems as item (item.id)}
							<li class="list-item-compact flex items-center justify-between gap-3">
								<div>
									<p class="text-sm font-medium text-slate-200">{item.name}</p>
									{#if item.companionName}<p class="text-xs text-slate-500">{item.companionName}</p>{/if}
									{#if item.serialNumber || item.trackerId}<p class="font-mono text-[10px] text-slate-500">{#if item.serialNumber}SN {item.serialNumber}{/if}{#if item.trackerId}{#if item.serialNumber} · {/if}ID {item.trackerId}{/if}</p>{/if}
									{#if item.notes}<p class="text-xs text-slate-500">{item.notes}</p>{/if}
								</div>
								{#if isEditor}
									<form method="POST" action="?/deleteImportantItem">
										<input type="hidden" name="itemId" value={item.id} />
										<button class="icon-button icon-button-sm" aria-label="Delete item"><Icon name="close" class="h-3.5 w-3.5" /></button>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="empty-text py-2">No important items recorded.</p>
				{/if}
				{#if isEditor}
					<form method="POST" action="?/addImportantItem" class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
						<input name="name" class="input text-sm" placeholder="Item name" required />
						<select name="companionId" class="input text-sm">
							<option value="">Unassigned</option>
							{#each data.companions ?? [] as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
						</select>
						<input name="serialNumber" class="input text-sm" placeholder="Serial #" />
						<input name="trackerId" class="input text-sm" placeholder="Tracker ID" />
						<textarea name="notes" class="input text-sm sm:col-span-3" placeholder="Notes" rows="2"></textarea>
						<button class="btn btn-primary btn-sm sm:col-span-3">Add item</button>
					</form>
				{/if}
				</section>
			{/if}

			<section class="card p-5">
				<h2 class="section-title mb-3">Activity</h2>
				{#if data.comments?.length}
					<ul class="list-stack">
						{#each data.comments as c (c.id)}
							<li class="list-item">
								<div class="flex items-center justify-between gap-3">
									<span class="subsection-title">{c.displayName}</span>
									<span class="text-xs text-slate-500">{new Date(c.createdAt).toLocaleString()}</span>
								</div>
								<p class="mt-1 text-sm text-slate-300 whitespace-pre-wrap">{c.body}</p>
								{#if c.userId === data.user?.id}
									<form method="POST" action="?/deleteComment" class="mt-2">
										<input type="hidden" name="commentId" value={c.id} />
										<button class="btn btn-ghost btn-ghost-danger btn-sm">Delete</button>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="empty-text py-4">No activity yet.</p>
				{/if}

				{#if isEditor}
					<form method="POST" action="?/addComment" class="mt-4 flex flex-col gap-2">
						<label for="commentBody" class="text-xs text-slate-400">Add a comment</label>
						<textarea id="commentBody" name="body" rows="2" class="input text-sm" placeholder="Write a note..." required></textarea>
						<div class="flex justify-end">
							<button class="btn btn-primary btn-sm">Post comment</button>
						</div>
					</form>
				{/if}
			</section>
		</div>

		<!-- Sidebar -->
		<aside class="space-y-4 lg:sticky lg:top-6 lg:self-start">
			<div class="trip-sidebar-card">
				<h2 class="subsection-title mb-3">Trip details</h2>
				<dl class="trip-sidebar-dl">
					<div>
						<dt>Status</dt>
						<dd><span class="badge badge-compact {tripStatusBadge(status).class}">{tripStatusBadge(status).label}</span></dd>
					</div>
					{#if trip.startDate}
						<div>
							<dt>Start date</dt>
							<dd>{formatDate(trip.startDate)}</dd>
						</div>
					{/if}
					{#if trip.endDate}
						<div>
							<dt>End date</dt>
							<dd>{formatDate(trip.endDate)}</dd>
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

			{#if data.stats}
				<div class="trip-sidebar-card">
					<h2 class="subsection-title mb-3">Trip stats</h2>
					<dl class="trip-sidebar-dl">
						<div>
							<dt>Segments</dt>
							<dd>{data.stats.totalSegments} ({data.stats.scheduledSegments} scheduled)</dd>
						</div>
						<div>
							<dt>Paid</dt>
							<dd>{data.stats.paidSegments}/{data.stats.totalSegments}</dd>
						</div>
						<div>
							<dt>Expenses</dt>
							<dd>{formatCents(data.stats.totalExpenses, data.stats.totalExpensesCurrency ?? baseCurrency)}</dd>
						</div>
						<div>
							<dt>Budget cap</dt>
							<dd>{formatCents(data.stats.budgetCap, baseCurrency)}</dd>
						</div>
						<div>
							<dt>Packing</dt>
							<dd>{data.stats.checklistPacked}/{data.stats.checklistTotal}</dd>
						</div>
					</dl>
				</div>
			{/if}

			{#if typeCounts.length}
				<div class="trip-sidebar-card">
					<h2 class="subsection-title mb-3">Plans by type</h2>
					<div class="space-y-2">
						{#each typeCounts as t (t.type)}
							{@const active = selectedTypes.has(t.type)}
							<button
								type="button"
								class="list-item-compact w-full flex cursor-pointer items-center justify-between gap-2 text-sm text-left {active ? 'list-item-compact-active' : ''}"
								onclick={() => toggleType(t.type)}
							>
								<span class="flex items-center gap-2 text-slate-300">
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-indigo-300/80">{@html SEG[t.type].icon}</svg>
									{SEG[t.type].label}
								</span>
								<span class="font-mono text-xs text-slate-500">{t.count}</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#if data.companions?.length}
				<div class="trip-sidebar-card">
					<div class="panel-header">
						<h2 class="subsection-title">Travelers</h2>
						<span class="font-mono text-xs text-slate-500">{data.companions.length}</span>
					</div>
					<ul class="space-y-2">
						{#each data.companions as c (c.id)}
							<li class="list-item-compact text-sm">
								{#if editingCompanionId === c.id}
									<form method="POST" action="?/updateCompanion" class="flex flex-col gap-2">
										<input type="hidden" name="companionId" value={c.id} />
										<input name="name" class="input text-sm" value={c.name} placeholder="Name" required />
										<div class="flex gap-2">
											<select name="category" class="input text-sm">
												<option value="adult" selected={c.category === 'adult'}>Adult</option>
												<option value="child" selected={c.category === 'child'}>Child</option>
												<option value="other" selected={c.category === 'other'}>Other</option>
											</select>
											<button class="btn btn-primary btn-sm shrink-0">Save</button>
										</div>
										<button
											type="button"
											class="btn btn-ghost btn-xs self-start"
											onclick={() => (showCompanionNotesId = showCompanionNotesId === c.id ? null : c.id)}
										>
											Notes {showCompanionNotesId === c.id ? '▲' : '▼'}
										</button>
										{#if showCompanionNotesId === c.id}
											<input name="dietary" class="input text-sm" placeholder="Dietary (optional)" value={c.dietary ?? ''} />
											<input name="allergies" class="input text-sm" placeholder="Allergies (optional)" value={c.allergies ?? ''} />
											<textarea name="medicalNotes" class="input text-sm" placeholder="Medical notes (optional)" rows="2">{c.medicalNotes ?? ''}</textarea>
											{#if c.category === 'child'}
												<div class="flex flex-wrap gap-3 text-xs">
													<label class="checkbox-label"><input type="checkbox" name="needsCarSeat" value="true" checked={c.needsCarSeat} class="checkbox" /> Car seat</label>
													<label class="checkbox-label"><input type="checkbox" name="needsStroller" value="true" checked={c.needsStroller} class="checkbox" /> Stroller</label>
													<label class="checkbox-label"><input type="checkbox" name="needsCrib" value="true" checked={c.needsCrib} class="checkbox" /> Crib</label>
													<label class="checkbox-label"><input type="checkbox" name="needsKidsMeal" value="true" checked={c.needsKidsMeal} class="checkbox" /> Kids meal</label>
												</div>
												<input name="childTicketDiscount" class="input text-sm" placeholder="Child ticket discount (optional)" value={c.childTicketDiscount ?? ''} />
											{/if}
											<select name="seatPreference" class="input text-sm">
												<option value="" selected={!c.seatPreference}>Seat preference…</option>
												<option value="aisle" selected={c.seatPreference === 'aisle'}>Aisle</option>
												<option value="window" selected={c.seatPreference === 'window'}>Window</option>
												<option value="middle" selected={c.seatPreference === 'middle'}>Middle</option>
												<option value="none" selected={c.seatPreference === 'none'}>No preference</option>
											</select>
											<select name="bedPreference" class="input text-sm">
												<option value="" selected={!c.bedPreference}>Bed preference…</option>
												<option value="king" selected={c.bedPreference === 'king'}>King</option>
												<option value="queen" selected={c.bedPreference === 'queen'}>Queen</option>
												<option value="twin" selected={c.bedPreference === 'twin'}>Twin</option>
												<option value="two_doubles" selected={c.bedPreference === 'two_doubles'}>Two doubles</option>
												<option value="other" selected={c.bedPreference === 'other'}>Other</option>
											</select>
											<input name="accessibilityNeeds" class="input text-sm" placeholder="Accessibility needs (optional)" value={c.accessibilityNeeds ?? ''} />
											<input name="roomNotes" class="input text-sm" placeholder="Room notes (optional)" value={c.roomNotes ?? ''} />
											<input name="notes" class="input text-sm" placeholder="General notes (optional)" value={c.notes ?? ''} />
										{/if}
										<button
											type="button"
											class="btn btn-ghost btn-xs self-start"
											onclick={() => (editingCompanionId = null)}
										>
											Cancel
										</button>
									</form>
								{:else}
									<div class="flex items-center justify-between gap-2">
										<span class="font-medium text-slate-200">{c.name}</span>
										<div class="flex items-center gap-1">
											<span class="badge badge-slate badge-compact capitalize">{c.category}</span>
											{#if isEditor}
												<button
													type="button"
													class="icon-button icon-button-sm"
													aria-label="Edit companion"
													onclick={() => (editingCompanionId = c.id)}
												>
													<Icon name="edit" class="h-3.5 w-3.5" />
												</button>
											{/if}
										</div>
									</div>
									{#if c.dietary || c.allergies || c.medicalNotes || c.notes}
										<div class="mt-1 flex flex-wrap gap-1">
											{#if c.dietary}
												<span class="badge badge-compact badge-amber" title={c.dietary}>
													<Icon name="dietary" class="h-3 w-3" />
													Dietary
												</span>
											{/if}
											{#if c.allergies}
												<span class="badge badge-compact badge-red" title={c.allergies}>
													<Icon name="allergies" class="h-3 w-3" />
													Allergies
												</span>
											{/if}
											{#if c.medicalNotes}
												<span class="badge badge-compact badge-brand" title={c.medicalNotes}>
													<Icon name="medical" class="h-3 w-3" />
													Medical
												</span>
											{/if}
											{#if c.notes}
												<span class="badge badge-compact badge-slate" title={c.notes}>Notes</span>
											{/if}
											{#if c.category === 'child' && (c.needsCarSeat || c.needsStroller || c.needsCrib || c.needsKidsMeal)}
												<span class="badge badge-compact badge-brand" title="Kid gear">
													{#if c.needsCarSeat}car seat{/if}{#if c.needsStroller}{#if c.needsCarSeat}, {/if}stroller{/if}{#if c.needsCrib}{#if c.needsCarSeat || c.needsStroller}, {/if}crib{/if}{#if c.needsKidsMeal}{#if c.needsCarSeat || c.needsStroller || c.needsCrib}, {/if}kids meal{/if}
												</span>
											{/if}
											{#if c.seatPreference}
												<span class="badge badge-compact badge-slate" title="Seat preference">{c.seatPreference}</span>
											{/if}
											{#if c.bedPreference}
												<span class="badge badge-compact badge-slate" title="Bed preference">{c.bedPreference.replace('_', ' ')}</span>
											{/if}</div>
									{/if}
								{/if}
							</li>
						{/each}
					</ul>
					{#if isEditor}
						<form method="POST" action="?/addCompanion" class="mt-3 flex flex-col gap-2">
							<input name="name" class="input text-sm" placeholder="Name" required />
							<div class="flex gap-2">
								<select name="category" class="input text-sm">
									<option value="adult">Adult</option>
									<option value="child">Child</option>
									<option value="other">Other</option>
								</select>
								<button class="btn btn-primary btn-sm shrink-0">Add</button>
							</div>
							<input name="notes" class="input text-sm" placeholder="Notes (optional)" />
							<button
								type="button"
								class="btn btn-ghost btn-xs self-start"
								onclick={() => (showAddCompanionNotes = !showAddCompanionNotes)}
							>
								Dietary / allergy / medical {showAddCompanionNotes ? '▲' : '▼'}
							</button>
							{#if showAddCompanionNotes}
								<input name="dietary" class="input text-sm" placeholder="Dietary (optional)" />
								<input name="allergies" class="input text-sm" placeholder="Allergies (optional)" />
								<textarea name="medicalNotes" class="input text-sm" placeholder="Medical notes (optional)" rows="2"></textarea>
								<div class="flex flex-wrap gap-3 text-xs">
									<label class="checkbox-label"><input type="checkbox" name="needsCarSeat" value="true" class="checkbox" /> Car seat</label>
									<label class="checkbox-label"><input type="checkbox" name="needsStroller" value="true" class="checkbox" /> Stroller</label>
									<label class="checkbox-label"><input type="checkbox" name="needsCrib" value="true" class="checkbox" /> Crib</label>
									<label class="checkbox-label"><input type="checkbox" name="needsKidsMeal" value="true" class="checkbox" /> Kids meal</label>
								</div>
								<input name="childTicketDiscount" class="input text-sm" placeholder="Child ticket discount (optional)" />
								<select name="seatPreference" class="input text-sm">
									<option value="">Seat preference…</option>
									<option value="aisle">Aisle</option>
									<option value="window">Window</option>
									<option value="middle">Middle</option>
									<option value="none">No preference</option>
								</select>
								<select name="bedPreference" class="input text-sm">
									<option value="">Bed preference…</option>
									<option value="king">King</option>
									<option value="queen">Queen</option>
									<option value="twin">Twin</option>
									<option value="two_doubles">Two doubles</option>
									<option value="other">Other</option>
								</select>
								<input name="accessibilityNeeds" class="input text-sm" placeholder="Accessibility needs (optional)" />
								<input name="roomNotes" class="input text-sm" placeholder="Room notes (optional)" />
							{/if}
						</form>
					{/if}
				</div>
			{/if}

			{#if isEditor && data.owner === true}
				<div class="trip-sidebar-card">
					<h2 class="subsection-title mb-3">Calendar feed</h2>
					{#if data.feedUrl}
						<p class="text-sm leading-relaxed text-slate-400">Subscribe to this trip with any calendar app.</p>
						<div class="mt-2 flex items-start gap-2">
							<p class="code-chip flex-1 px-2.5 text-[10px] leading-relaxed">{data.feedUrl}</p>
							<CopyButton text={data.feedUrl} class="btn btn-ghost shrink-0" label="Copy" />
						</div>
						<div class="mt-3 flex flex-col gap-2">
							<form method="POST" action="?/regenerateCalendarFeed" class="flex flex-col gap-2">
								<label for="calendarExpiresAt" class="text-xs text-slate-400">New URL expires (optional)</label>
								<input id="calendarExpiresAt" name="calendarExpiresAt" type="datetime-local" class="input text-sm" />
								<button class="btn btn-primary w-full">Regenerate URL</button>
							</form>
							<form method="POST" action="?/revokeCalendarFeed">
								<button class="btn btn-danger w-full">Revoke feed</button>
							</form>
						</div>
					{:else}
						<p class="text-xs text-slate-400">Generate a public .ics feed URL for this trip. You can optionally set an expiry.</p>
						<form method="POST" action="?/regenerateCalendarFeed" class="mt-3 flex flex-col gap-2">
								<label for="calendarExpiresAt" class="text-xs text-slate-400">Expires (optional)</label>
								<input id="calendarExpiresAt" name="calendarExpiresAt" type="datetime-local" class="input text-sm" />
								<button class="btn btn-primary w-full">Generate feed URL</button>
							</form>
					{/if}
				</div>
			{/if}

				{#if isEditor && data.owner === true && trip.startDate}
					<div class="trip-sidebar-card">
						<h2 class="subsection-title mb-3">Custom reminder</h2>
						<form method="POST" action="?/customReminder" class="flex flex-col gap-2">
							<label for="customReminderOffset" class="text-xs text-slate-400">Remind me before start</label>
							<select id="customReminderOffset" name="offsetMinutes" class="input text-sm">
								{#each REMINDER_OFFSETS as offset}
									<option value={offset.minutes}>{offset.label}</option>
								{/each}
							</select>
							<button class="btn btn-ghost btn-sm">Set reminder</button>
						</form>
					</div>
				{/if}

			{#if isEditor}
				<div class="trip-sidebar-card">
					<h2 class="subsection-title mb-3">Quick links</h2>
					<nav class="flex flex-col gap-1">
						<a href={`/trips/${trip.id}/edit`} class="nav-link">Edit trip info</a>
						<a href={`/trips/${trip.id}/calendar`} class="nav-link">Download calendar</a>
						{#if data.owner === true}
							<a href={`/trips/${trip.id}/share`} class="nav-link">Sharing settings</a>
						{/if}
					</nav>
				</div>
			{/if}

			{#if data.owner === true && data.emergencyContacts?.length}
				<div class="trip-sidebar-card">
					<h2 class="subsection-title mb-3">
						<Icon name="share" class="inline h-4 w-4 mr-1.5" />
						Share with emergency contact
					</h2>
					<form method="POST" action="?/shareItineraryWithContact" class="flex flex-col gap-2">
						<label for="emergencyContactId" class="text-xs text-slate-400">Select contact</label>
						<select id="emergencyContactId" name="contactId" class="input text-sm" required>
							{#each data.emergencyContacts as c (c.id)}
								<option value={c.id}>{c.name}{#if c.relationship} ({c.relationship}){/if}</option>
							{/each}
						</select>
						<button class="btn btn-primary btn-sm w-full">Send itinerary link</button>
					</form>
				</div>
			{/if}

			{#if data.documentLinks?.length || isEditor}
				<div class="trip-sidebar-card">
					<h2 class="subsection-title mb-3">Trip documents</h2>
					{#if data.documentLinks?.length}
						<ul class="space-y-2">
							{#each data.documentLinks as link (link.id)}
								<li class="list-item-compact">
									<a href={link.url} target="_blank" rel="noopener noreferrer" class="link text-sm">{link.label}</a>
									{#if link.notes}<p class="mt-0.5 text-xs text-slate-500">{link.notes}</p>{/if}
									{#if isEditor}
										<form method="POST" action="?/deleteDocumentLink" class="mt-1">
											<input type="hidden" name="linkId" value={link.id} />
											<button class="btn btn-ghost btn-ghost-danger btn-xs">Remove</button>
										</form>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
					{#if isEditor}
						<form method="POST" action="?/addDocumentLink" class="mt-3 flex flex-col gap-2">
							<input name="label" class="input text-sm" placeholder="Label" required />
							<input name="url" type="url" class="input text-sm" placeholder="https://..." required />
							<input name="notes" class="input text-sm" placeholder="Notes (optional)" />
							<button class="btn btn-primary btn-sm">Add link</button>
						</form>
					{/if}
				</div>
			{/if}

			{#if isEditor && (data.policies?.length || data.availablePolicies?.length)}
				<div class="trip-sidebar-card">
					<h2 class="subsection-title mb-3">Insurance</h2>
					{#if data.policies?.length}
						<ul class="space-y-2">
							{#each data.policies as p (p.id)}
								<li class="list-item p-2.5">
									<p class="text-sm font-medium text-white">{p.provider}</p>
									{#if p.policyNumber}<p class="font-mono text-[10px] text-slate-500">{p.policyNumber}</p>{/if}
									{#if p.coverageSummary}<p class="mt-1 text-xs text-slate-400">{p.coverageSummary}</p>{/if}
									{#if p.startDate || p.endDate}<p class="mt-1 font-mono text-[10px] text-slate-500">{p.startDate || '—'} → {p.endDate || '—'}</p>{/if}
									{#if data.owner === true}
										<form method="POST" action="?/detachPolicy" class="mt-2">
											<input type="hidden" name="policyId" value={p.id} />
											<button class="btn btn-ghost btn-ghost-danger btn-sm">Detach</button>
										</form>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
					{#if data.owner === true && data.availablePolicies?.length}
						<form method="POST" action="?/attachPolicy" class="mt-3 flex flex-col gap-2">
							<select name="policyId" class="input text-sm">
								{#each data.availablePolicies as p}
									<option value={p.id}>{p.provider}{#if p.policyNumber} — {p.policyNumber}{/if}</option>
								{/each}
							</select>
							<button class="btn btn-primary btn-sm">Attach policy</button>
						</form>
					{/if}
				</div>
			{/if}
		</aside>
	</div>
</div>
