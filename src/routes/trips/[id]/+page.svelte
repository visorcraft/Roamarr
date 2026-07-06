<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { invalidateAll, replaceState } from '$app/navigation';
	import CancelButton from '$lib/components/CancelButton.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import TimezoneSelect from '$lib/components/TimezoneSelect.svelte';
	import CardSelect from '$lib/components/CardSelect.svelte';
	import CityAutocomplete from '$lib/components/segments/CityAutocomplete.svelte';
	import SegmentEditForm from '$lib/components/segments/SegmentEditForm.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { COUNTRIES } from '$lib/countries';
	import type { IconName } from '$lib/icons';
	import { SEG, SEGMENT_TYPES, type SegmentType } from '$lib/segmentLabels';
	import { weatherIconForCode } from '$lib/weatherCodes';
	import { DateTime } from 'luxon';
	import type { Trip } from '$lib/server/repositories/tripsRepo';
	import { renderMarkdown } from '$lib/markdown';
	import { formatDateTime, formatDate, formatTime } from '$lib/dateFormat';
	import { formatDestination } from '$lib/tripDestination';
	import { formatCents } from '$lib/money';
	import { REMINDER_OFFSETS } from '$lib/reminderOffsets';
	import { SEGMENT_STATUSES, segmentStatusLabel, segmentStatusClass } from '$lib/segmentStatus';
	import { tripStatusBadge } from '$lib/tripStatus';
	import { visibilityBadgeClass } from '$lib/visibility';
	import { onMount, tick } from 'svelte';
	import type { PageData, SubmitFunction } from './$types';
	import TripMap from '$lib/components/TripMap.svelte';
	import GlobeModal from '$lib/components/GlobeModal.svelte';

	let { data, form }: { data: PageData; form?: { error?: string; errors?: Record<string, string> } } = $props();
	type TripTab = 'itinerary' | 'prep' | 'money' | 'people' | 'notes' | 'documents' | 'tools';
	type TripTabLink = { id: TripTab; label: string; icon: IconName; count?: number | null; visible: boolean };
	const TRIP_TAB_IDS = ['itinerary', 'prep', 'money', 'people', 'notes', 'documents', 'tools'] as const;

	let globeOpen = $state(false);
	let editingId = $state<number | null>(null);
	let editingCompanionId = $state<number | null>(null);
	let dirtyCompanionIds = $state<Record<number, boolean>>({});
	let showCompanionNotesId = $state<number | null>(null);
	let showAddCompanionNotes = $state(false);
	let activeTab = $state<TripTab>('itinerary');
	let selectedCompanionByPoll = $state<Record<number, string>>({});
	let selectedTypes = $state<Set<SegmentType>>(new Set());
	let selectedSegmentIds = $state<Set<number>>(new Set());
	let segmentQuery = $state('');
	let draggingSegmentId = $state<number | null>(null);
	let draggingSegmentDate = $state<string | null>(null);
	let dragOverDate = $state<string | null>(null);
	let moveSegmentDateForm = $state<HTMLFormElement | null>(null);
	let moveSegmentIdInput = $state<HTMLInputElement | null>(null);
	let moveTargetDateInput = $state<HTMLInputElement | null>(null);

	function toggleType(type: SegmentType) {
		const next = new Set(selectedTypes);
		if (next.has(type)) {
			next.delete(type);
		} else {
			next.add(type);
		}
		selectedTypes = next;
	}

	function isTripTab(value: string | null | undefined): value is TripTab {
		return TRIP_TAB_IDS.includes(value as TripTab);
	}

	function selectTripTab(tab: TripTab) {
		activeTab = tab;
		if (typeof window === 'undefined') return;
		window.localStorage.setItem(`roamarr:trip:${trip.id}:tab`, tab);
		replaceState(`${window.location.pathname}${window.location.search}#${tab}`, {});
	}

	onMount(() => {
		const hashTab = window.location.hash.slice(1);
		const savedTab = window.localStorage.getItem(`roamarr:trip:${trip.id}:tab`);
		if (isTripTab(hashTab)) {
			activeTab = hashTab;
		} else if (isTripTab(savedTab)) {
			activeTab = savedTab;
		}
	});

	type SharedSegment = {
		type: string;
		title: string;
		startAt: string | null;
		endAt: string | null;
		location: string | null;
		countryCode?: string | null;
		cityName?: string | null;
		cityLat?: number | null;
		cityLng?: number | null;
		venue?: string | null;
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

	function posterInitials(name: string, cityName: string | null | undefined) {
		const src = cityName?.trim() || name;
		return src
			.split(/[\s,]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('');
	}

	function segmentLocalDateTime(segment: SegmentRow) {
		if (!segment.startAt) return null;
		const dt = DateTime.fromISO(segment.startAt, { zone: 'utc' }).setZone(segment.startTz ?? 'UTC');
		return dt.isValid ? dt : null;
	}

	function groupSegmentsByDay(segments: SegmentRow[]) {
		const sorted = [...segments].sort((a, b) => {
			const aLocal = segmentLocalDateTime(a);
			const bLocal = segmentLocalDateTime(b);
			const aKey = aLocal?.toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS") ?? (a.startAt ?? '');
			const bKey = bLocal?.toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS") ?? (b.startAt ?? '');
			return aKey.localeCompare(bKey);
		});
		const groups: { key: string; label: string; segments: SegmentRow[] }[] = [];
		const index = new Map<string, number>();
		for (const s of sorted) {
			let key = 'unscheduled';
			let label = 'Unscheduled';
			const dt = segmentLocalDateTime(s);
			if (dt) {
				key = dt.toISODate()!;
				label = dt.toFormat('EEEE, MMMM d, yyyy');
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
	const ownerTrip = $derived(data.owner === true ? (trip as Trip) : undefined);
	const baseCurrency = $derived(ownerTrip?.baseCurrency ?? (trip as Trip).baseCurrency ?? 'USD');
	const segmentList = $derived(
		isEditor ? (data.segments as SegmentRow[]) : ((data.trip as { segments: SharedSegment[] }).segments as SegmentRow[])
	);

	function toggleSegmentId(id: number) {
		const next = new Set(selectedSegmentIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedSegmentIds = next;
	}

	function handleSegmentCardClick(id: number, event: MouseEvent) {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (target.closest('button, a, input, select, textarea, label, [role="button"], form')) return;
		toggleSegmentId(id);
	}

	function startSegmentDrag(segmentId: number, dateKey: string, event: DragEvent) {
		draggingSegmentId = segmentId;
		draggingSegmentDate = dateKey;
		event.dataTransfer?.setData('application/x-roamarr-segment-id', String(segmentId));
		event.dataTransfer?.setData('text/plain', String(segmentId));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function draggedSegmentId(event: DragEvent) {
		const raw =
			event.dataTransfer?.getData('application/x-roamarr-segment-id') ||
			event.dataTransfer?.getData('text/plain') ||
			(draggingSegmentId != null ? String(draggingSegmentId) : '');
		const id = Number(raw);
		return Number.isInteger(id) && id > 0 ? id : null;
	}

	function allowDayDrop(event: DragEvent, dateKey: string) {
		if (!isEditor || dateKey === 'unscheduled') return;
		if (draggingSegmentId == null && !event.dataTransfer?.types.includes('application/x-roamarr-segment-id')) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		if (draggingSegmentDate !== dateKey) dragOverDate = dateKey;
	}

	function leaveDayDrop(event: DragEvent, dateKey: string) {
		const current = event.currentTarget;
		const related = event.relatedTarget;
		if (current instanceof HTMLElement && related instanceof Node && current.contains(related)) return;
		if (dragOverDate === dateKey) dragOverDate = null;
	}

	function dropSegmentOnDay(event: DragEvent, dateKey: string) {
		if (!isEditor || dateKey === 'unscheduled') return;
		event.preventDefault();
		const segmentId = draggedSegmentId(event);
		dragOverDate = null;
		draggingSegmentId = null;
		const sourceDate = draggingSegmentDate;
		draggingSegmentDate = null;
		if (!segmentId || sourceDate === dateKey) return;
		if (!moveSegmentDateForm || !moveSegmentIdInput || !moveTargetDateInput) return;
		moveSegmentIdInput.value = String(segmentId);
		moveTargetDateInput.value = dateKey;
		moveSegmentDateForm.requestSubmit();
	}

	const preserveScrollOnMove: SubmitFunction = () => {
		const x = window.scrollX;
		const y = window.scrollY;
		return async ({ result }) => {
			if (result.type === 'redirect' || result.type === 'success') {
				await invalidateAll();
				await tick();
				window.scrollTo(x, y);
				return;
			}
			await applyAction(result);
		};
	};

	function endSegmentDrag() {
		draggingSegmentId = null;
		draggingSegmentDate = null;
		dragOverDate = null;
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
	const destinationLabel = $derived(formatDestination(trip.destinationCityName, trip.destinationCountryCode));
	const typeCounts = $derived(
		SEGMENT_TYPES.map((type) => ({
			type,
			count: segmentList.filter((s) => s.type === type).length
		})).filter((t) => t.count > 0)
	);
	const prepItemCount = $derived(
		(data.checklist?.items?.length ?? 0) +
			(data.homeTasks?.length ?? 0) +
			(data.medications?.length ?? 0) +
			(data.entryRequirements?.length ?? 0) +
			(data.importantItems?.length ?? 0)
	);
	const budgetCapCount = $derived(data.budgets?.filter((b) => b.amount != null).length ?? 0);
	const moneyItemCount = $derived((data.expenses?.length ?? 0) + budgetCapCount + (data.watches?.length ?? 0));
	const peopleItemCount = $derived((data.companions?.length ?? 0) + (data.polls?.length ?? 0));
	const notesItemCount = $derived((data.journalEntries?.length ?? 0) + (data.comments?.length ?? 0));
	const documentsItemCount = $derived(
		(data.documentLinks?.length ?? 0) + (data.policies?.length ?? 0)
	);
	const hasPrepTab = $derived(isEditor || prepItemCount > 0);
	const hasMoneyTab = $derived(
		isEditor || moneyItemCount > 0 || data.budgets?.some((b) => b.amount != null) === true
	);
	const hasPeopleTab = $derived(
		isEditor || peopleItemCount > 0 || (data.owner === true && (data.emergencyContacts?.length ?? 0) > 0)
	);
	const hasNotesTab = $derived(isEditor || notesItemCount > 0);
	const hasDocumentsTab = $derived(isEditor || documentsItemCount > 0 || (data.availablePolicies?.length ?? 0) > 0);
	const hasToolsTab = $derived(isEditor);
	const tripTabs = $derived(
		([
			{ id: 'itinerary', label: 'Itinerary', icon: 'trips', count: segmentList.length, visible: true },
			{ id: 'prep', label: 'Prep', icon: 'check', count: prepItemCount, visible: hasPrepTab },
			{ id: 'money', label: 'Money', icon: 'budget', count: moneyItemCount, visible: hasMoneyTab },
			{ id: 'people', label: 'People', icon: 'users', count: peopleItemCount, visible: hasPeopleTab },
			{ id: 'notes', label: 'Notes', icon: 'edit', count: notesItemCount, visible: hasNotesTab },
			{ id: 'documents', label: 'Documents', icon: 'document', count: documentsItemCount, visible: hasDocumentsTab },
			{ id: 'tools', label: 'Tools', icon: 'settings', count: null, visible: hasToolsTab }
		] satisfies TripTabLink[]).filter((tab) => tab.visible)
	);
	const activeTabHasSidebar = $derived(
		activeTab === 'itinerary' || activeTab === 'people' || activeTab === 'documents' || activeTab === 'tools'
	);
	const activeTabMainHidden = $derived(
		activeTab === 'documents' || (activeTab === 'tools' && data.owner !== true)
	);

	$effect(() => {
		if (!tripTabs.some((tab) => tab.id === activeTab)) activeTab = 'itinerary';
	});

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
	<section class="trip-hero {data.nextCity && data.tileConfig ? 'trip-hero--map' : ''}">
		<div class="trip-hero-backdrop"></div>
		{#if data.nextCity && data.tileConfig}
			<div class="trip-hero-map-layer">
				<TripMap
					fill
					lat={data.nextCity.lat}
					lng={data.nextCity.lng}
					cityName={data.nextCity.cityName}
					tileUrls={data.tileConfig.tileUrls}
					attribution={data.tileConfig.attribution}
					onExpand={() => (globeOpen = true)}
				/>
			</div>
			<div class="trip-hero-map-scrim"></div>
		{/if}
		<div class="trip-hero-scrim"></div>

		<div class="trip-hero-content relative px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
			<a href="/trips" class="back-link">
				<Icon name="back" class="h-4 w-4" />
				Back to trips
			</a>

			<div class="flex flex-col gap-6 sm:flex-row sm:items-end">
				{#if !(data.nextCity && data.tileConfig)}
					<div class="trip-poster grid place-items-center">
						<div class="text-center">
							<Icon name="location" class="trip-poster-icon mx-auto h-8 w-8" />
							<p class="trip-poster-initials mt-2 font-display text-2xl font-bold">{posterInitials(trip.name, trip.destinationCityName)}</p>
						</div>
					</div>
				{/if}

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

					<h1 class="trip-hero-title mt-2 text-3xl font-extrabold sm:text-4xl">{trip.name}</h1>

					<div class="mt-3 flex flex-wrap gap-2">
						{#if destinationLabel}
							<span class="trip-meta-pill">
								<Icon name="location" class="h-3.5 w-3.5 text-slate-500" />
								{destinationLabel}
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
									{#if data.owner === true}
										<form method="POST" action="?/markVisitedPlaces">
											<button class="app-user-menu-item app-user-menu-button w-full" type="submit">
												<Icon name="location" class="h-4.5 w-4.5" />
												<span>Mark places visited</span>
											</button>
										</form>
									{/if}
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

	{#if data.nextCity && data.tileConfig}
		<GlobeModal
			bind:open={globeOpen}
			lat={data.nextCity.lat}
			lng={data.nextCity.lng}
			cityName={data.nextCity.cityName}
		/>
	{/if}

	<div class="trip-detail-body mt-6">
		<nav class="trip-tab-list" aria-label="Trip sections">
			{#each tripTabs as tab (tab.id)}
				<button
					type="button"
					id={`trip-tab-${tab.id}`}
					aria-current={activeTab === tab.id ? 'page' : undefined}
					class="trip-tab-link {activeTab === tab.id ? 'trip-tab-link-active' : ''}"
					onclick={() => selectTripTab(tab.id)}
				>
					<Icon name={tab.icon} class="h-4 w-4" />
					<span>{tab.label}</span>
					{#if tab.count != null && tab.count > 0}
						<span class="trip-tab-count">{tab.count}</span>
					{/if}
				</button>
			{/each}
		</nav>
	</div>

	<div class="trip-detail-body px-4 trip-tab-layout {activeTabHasSidebar ? 'trip-tab-layout-with-sidebar' : ''}">
		<!-- Main column -->
		<div class="min-w-0 space-y-8 {activeTabHasSidebar ? '' : 'trip-tab-main-wide'} {activeTabMainHidden ? 'hidden' : ''}">
			{#if activeTab === 'itinerary' && ownerTrip?.notes}
				<section>
					<h2 class="section-title mb-3">Overview</h2>
					<div class="prose prose-invert max-w-none text-sm leading-relaxed text-slate-300">{@html renderMarkdown(ownerTrip.notes)}</div>
				</section>
			{/if}

			{#if activeTab === 'itinerary' && data.weather?.days?.length}
				<section class="mb-6">
					<h2 class="section-title mb-3">
						Weather forecast
						<span class="text-xs font-normal text-muted">({data.weather.tempUnit})</span>
					</h2>
					{#if data.weather.degraded}
						<p class="notice notice-info mb-2">Using last-known forecast — Open-Meteo is unavailable.</p>
					{/if}
					{#if data.weather.advisory}
						<p class="notice notice-warning mb-2">{data.weather.advisory}</p>
					{/if}
					<div class="flex gap-2 overflow-x-auto pb-2">
						{#each data.weather.days as d (d.date)}
							{@const icon = weatherIconForCode(d.code)}
							<div class="min-w-[110px] shrink-0 rounded-lg bg-surface2 p-3 text-center ring-1 ring-inset ring-white/5">
								<div class="text-xs font-medium text-muted">{new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
								{#if icon}
									<div class="mx-auto my-1 flex h-7 items-center justify-center text-ink">
										<Icon name={icon} class="h-6 w-6" />
									</div>
								{/if}
								{#if d.code != null}
									<div class="my-1 text-2xl font-light text-ink">
										{d.tempMax != null ? `${Math.round(d.tempMax)}°` : '—'}
										{#if d.tempMin != null}<span class="text-sm text-muted">/{Math.round(d.tempMin)}°</span>{/if}
									</div>
									<div class="text-xs text-muted">{d.summary}</div>
									{#if d.precipProb != null && d.precipProb > 0}
										<div class="mt-0.5 text-[11px] text-brand">{d.precipProb}% precip</div>
									{/if}
								{:else}
									<div class="my-2 text-xs text-muted">{d.summary}</div>
								{/if}
								{#if d.locationLabel}
									<div class="mt-1 truncate text-[10px] text-muted">{d.locationLabel}</div>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if activeTab === 'itinerary'}
			<section id="trip-panel-itinerary">
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
										class="btn btn-danger btn-xs"
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

					{#if isEditor}
						<form
							method="POST"
							action="?/moveSegmentDate"
							class="hidden"
							bind:this={moveSegmentDateForm}
							use:enhance={preserveScrollOnMove}
						>
							<input type="hidden" name="segmentId" bind:this={moveSegmentIdInput} />
							<input type="hidden" name="targetDate" bind:this={moveTargetDateInput} />
						</form>
					{/if}

					{#if dayGroups.length}
						<div class="trip-timeline-groups space-y-8">
							{#each dayGroups as group (group.key)}
								<div
									class="trip-timeline-day-group {dragOverDate === group.key ? 'trip-timeline-day-group-drop' : ''}"
									role="list"
									aria-label={`${group.label} itinerary plans`}
									ondragover={(e) => allowDayDrop(e, group.key)}
									ondragenter={(e) => allowDayDrop(e, group.key)}
									ondragleave={(e) => leaveDayDrop(e, group.key)}
									ondrop={(e) => dropSegmentOnDay(e, group.key)}
								>
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
												<SegmentEditForm segment={s} tripId={trip.id} errors={form?.errors ?? {}} cards={data.cards ?? []} onCancel={() => (editingId = null)} />
											{:else}
										<!-- svelte-ignore a11y_click_events_have_key_events -->
										<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
											<article
												class="trip-timeline-card {isEditor && s.id && selectedSegmentIds.has(s.id) ? 'trip-timeline-card-selected' : ''} {isEditor && s.id ? 'trip-timeline-card-selectable' : ''} {draggingSegmentId === s.id ? 'trip-timeline-card-dragging' : ''}"
												onclick={(e) => isEditor && s.id != null && handleSegmentCardClick(s.id, e)}
												draggable={isEditor && s.id != null}
												ondragstart={(e) => s.id != null && startSegmentDrag(s.id, group.key, e)}
												ondragend={endSegmentDrag}
											>
												<div class="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start">
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
																class="sr-only"
																aria-label="Select segment"
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
																		{#if s.cityName || s.venue}
																			<p class="mt-1.5 text-sm text-slate-400">
																				{#if s.cityName}{s.cityName}{#if s.countryCode}, {s.countryCode.toUpperCase()}{/if}{/if}
																				{#if s.cityName && s.venue}<span class="mx-1 text-slate-500">·</span>{/if}
																				{#if s.venue}{s.venue}{/if}
																			</p>
																		{/if}
																		{#if s.location && !s.cityName}
																			<p class="mt-1.5 text-sm text-slate-500 italic">Legacy location: {s.location}</p>
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
																	<pre class="whitespace-pre-wrap font-mono text-xs text-slate-400">{s.detailsJson}</pre>
																</div>
															{/if}
														</div>
												{#if data.companions?.length && s.id}
													{@const attendees = data.attendeesBySegment?.get(s.id) ?? []}
													{#if attendees.length}
															<div class="mt-2 flex w-full flex-wrap gap-1.5 lg:basis-full lg:pl-20">
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
																	<div class="flex w-full flex-wrap items-center gap-1 lg:basis-full lg:pl-20">
																<button type="button" class="btn btn-primary" onclick={() => (editingId = s.id ?? null)}>Edit</button>
													<form method="POST" action="?/duplicateSegment">
														<input type="hidden" name="segmentId" value={s.id} />
														<button class="btn btn-primary">Duplicate</button>
													</form>
																<form method="POST" action={`/trips/${trip.id}/segments?/delete`}>
																	<input type="hidden" name="segmentId" value={s.id} />
																	<button class="btn btn-danger">Delete</button>
																</form>
																<form method="POST" action={`/trips/${trip.id}?/segmentReminder`} class="flex items-center gap-1">
																	<input type="hidden" name="segmentId" value={s.id} />
																	<select name="offsetMinutes" class="input text-sm w-auto">
																		{#each REMINDER_OFFSETS.filter((o) => o.minutes <= 1440) as offset}
																			<option value={offset.minutes}>{offset.shortLabel}</option>
																		{/each}
																	</select>
																	<button class="btn btn-primary btn-sm">Remind</button>
																</form>
																{#if data.providers?.length}
																	<form method="POST" action={`/trips/${trip.id}/fare-watch?/enable`} class="flex items-center gap-1">
																		<input type="hidden" name="segmentId" value={s.id} />
																		<select name="providerId" class="select select-compact w-auto">
																		{#each data.providers as p (p.id)}
																			<option value={p.id}>{p.label || p.providerKey}</option>
																		{/each}
																		</select>
																		<button class="btn btn-primary btn-sm">Watch</button>
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
			{/if}

			{#if activeTab === 'prep' && (data.checklist?.items?.length || isEditor)}
				<section class="card p-5">
					<div class="panel-header">
						<h2 class="section-title">Packing checklist</h2>
						<div class="flex items-center gap-2">
							{#if isEditor && data.checklist?.items?.length}
								<form method="POST" action="?/setAllChecklistItems">
									<input type="hidden" name="packed" value="true" />
									<button class="btn btn-primary btn-xs" type="submit">Pack all</button>
								</form>
								<form method="POST" action="?/setAllChecklistItems">
									<input type="hidden" name="packed" value="false" />
									<button class="btn btn-primary btn-xs" type="submit">Unpack all</button>
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
							<button class="btn btn-primary btn-sm">Save template</button>
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

			{#if activeTab === 'money' && (data.expenses?.length || isEditor)}
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
						<ul class="space-y-2" data-testid="expense-list">
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
							<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" class="input w-32 text-sm" placeholder="Amount" required />
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
									<button class="btn btn-primary btn-sm">Upload</button>
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

			{#if activeTab === 'money' && (isEditor || data.budgets?.some((b) => b.amount != null))}
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

			{#if activeTab === 'notes' && (data.journalEntries?.length || isEditor)}
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
											<button class="btn btn-danger btn-xs">Delete</button>
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

			{#if activeTab === 'people' && (data.polls?.length || isEditor)}
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

			{#if activeTab === 'money' && isEditor && data.owner === true && (data.providers?.length || data.watches?.length)}
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
								<button class="btn btn-primary">Enable</button>
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
											<button class="btn btn-primary">Check now</button>
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
											<button class="btn btn-danger">Delete</button>
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

			{#if activeTab === 'tools' && isEditor && data.owner === true}
				<section class="card p-5">
					<h2 class="section-title mb-3">Save as template</h2>
					<form method="POST" action="?/saveTripTemplate" class="flex flex-wrap items-end gap-2">
						<input name="name" class="input text-sm min-w-0 flex-1" placeholder="Template name" required maxlength="100" />
						<button class="btn btn-primary btn-sm">Save template</button>
					</form>
				</section>
			{/if}

			{#if activeTab === 'prep' && (data.homeTasks?.length || isEditor)}
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

			{#if activeTab === 'prep' && (data.medications?.length || isEditor)}
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

			{#if activeTab === 'prep' && (data.entryRequirements?.length || isEditor)}
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

			{#if activeTab === 'prep' && (data.importantItems?.length || isEditor)}
				<section class="card p-5">
					<h2 class="section-title mb-3">Important items</h2>
				{#if data.importantItems?.length}
					<ul class="space-y-2">
						{#each data.importantItems as item (item.id)}
							<li class="list-item-compact flex items-center justify-between gap-3">
								<div>
									<p class="text-sm font-medium text-slate-200">{item.name}</p>
									{#if item.companionName}<p class="text-xs text-slate-500">{item.companionName}</p>{/if}
									{#if item.serialNumber || item.trackerId}<p class="font-mono text-xs text-slate-500">{#if item.serialNumber}SN {item.serialNumber}{/if}{#if item.trackerId}{#if item.serialNumber} · {/if}ID {item.trackerId}{/if}</p>{/if}
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

			{#if activeTab === 'notes'}
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
										<button class="btn btn-danger btn-sm">Delete</button>
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
			{/if}
		</div>

		<!-- Sidebar -->
		{#if activeTabHasSidebar}
		<aside class="space-y-4 {activeTabMainHidden ? 'trip-tab-main-wide' : ''} lg:sticky lg:top-6 lg:self-start">
			{#if activeTab === 'itinerary'}
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
					{#if destinationLabel}
						<div>
							<dt>Destination</dt>
							<dd>{destinationLabel}</dd>
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
			{/if}

			{#if activeTab === 'people' && (data.companions?.length || isEditor)}
				<div class="trip-sidebar-card">
					<div class="panel-header">
						<h2 class="subsection-title">Travelers</h2>
						<span class="font-mono text-xs text-slate-500">{data.companions?.length ?? 0}</span>
					</div>
					{#if data.companions?.length}
						<ul class="space-y-2">
							{#each data.companions as c (c.id)}
							<li class="list-item-compact text-sm">
							{#if editingCompanionId === c.id}
								<form method="POST" action="?/updateCompanion" class="flex flex-col gap-2" oninput={() => (dirtyCompanionIds[c.id] = true)}>
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
									<CancelButton
										class="btn btn-ghost btn-xs self-end"
										dirty={dirtyCompanionIds[c.id] ?? false}
										onConfirm={() => (editingCompanionId = null)}
									>
										Cancel
									</CancelButton>
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
												onclick={() => { editingCompanionId = c.id; dirtyCompanionIds[c.id] = false; }}
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
			{:else}
				<p class="empty-text py-2">No travelers yet.</p>
			{/if}
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

			{#if activeTab === 'tools' && isEditor && data.owner === true}
				<div class="trip-sidebar-card">
					<h2 class="subsection-title mb-3">Calendar feed</h2>
					{#if data.feedUrl}
						<p class="text-sm leading-relaxed text-slate-400">Subscribe to this trip with any calendar app.</p>
						<div class="mt-2 flex items-start gap-2">
							<p class="code-chip flex-1 px-2.5 text-xs leading-relaxed">{data.feedUrl}</p>
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

				{#if activeTab === 'tools' && isEditor && data.owner === true && trip.startDate}
					<div class="trip-sidebar-card">
						<h2 class="subsection-title mb-3">Custom reminder</h2>
						<form method="POST" action="?/customReminder" class="flex flex-col gap-2">
							<label for="customReminderOffset" class="text-xs text-slate-400">Remind me before start</label>
							<select id="customReminderOffset" name="offsetMinutes" class="input text-sm">
								{#each REMINDER_OFFSETS as offset}
									<option value={offset.minutes}>{offset.label}</option>
								{/each}
							</select>
							<button class="btn btn-primary btn-sm">Set reminder</button>
						</form>
					</div>
				{/if}

			{#if activeTab === 'tools' && isEditor}
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

			{#if activeTab === 'people' && data.owner === true && data.emergencyContacts?.length}
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

			{#if activeTab === 'documents' && (data.documentLinks?.length || isEditor)}
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
											<button class="btn btn-danger btn-xs">Remove</button>
										</form>
									{/if}
								</li>
							{/each}
						</ul>
					{:else}
						<p class="empty-text py-2">No documents linked yet.</p>
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

			{#if activeTab === 'documents' && isEditor && (data.policies?.length || data.availablePolicies?.length)}
				<div class="trip-sidebar-card">
					<h2 class="subsection-title mb-3">Insurance</h2>
					{#if data.policies?.length}
						<ul class="space-y-2">
							{#each data.policies as p (p.id)}
								<li class="list-item p-2.5">
									<p class="text-sm font-medium text-white">{p.provider}</p>
									{#if p.policyNumber}<p class="font-mono text-xs text-slate-500">{p.policyNumber}</p>{/if}
									{#if p.coverageSummary}<p class="mt-1 text-xs text-slate-400">{p.coverageSummary}</p>{/if}
									{#if p.startDate || p.endDate}<p class="mt-1 font-mono text-xs text-slate-500">{p.startDate || '—'} → {p.endDate || '—'}</p>{/if}
									{#if data.owner === true}
										<form method="POST" action="?/detachPolicy" class="mt-2">
											<input type="hidden" name="policyId" value={p.id} />
											<button class="btn btn-danger btn-sm">Detach</button>
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
		{/if}
	</div>
</div>
