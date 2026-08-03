<script lang="ts">
	import './trip-detail-modern.css';
	import './trip-detail-modern-fixes.css';
	import { applyAction, enhance } from '$app/forms';
	import { invalidateAll, replaceState } from '$app/navigation';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import SegmentEditForm from '$lib/components/segments/SegmentEditForm.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/icons';
	import { SEG, SEGMENT_TYPES, usesPickupDropoff, type SegmentType } from '$lib/segmentLabels';
	import { compareSegmentsWithinDay, isUntimedSegment } from '$lib/segmentDay';
	import { buildGoogleMapsDirectionsUrl } from '$lib/googleMaps';
	import { DateTime } from 'luxon';
	import type { Trip } from '$lib/server/repositories/tripsRepo';
	import MarkdownText from '$lib/components/MarkdownText.svelte';
	import { formatArrivalLocal, formatZoneLabel } from '$lib/dateFormat';
	import { useDateFormat } from '$lib/dateFormatContext.svelte';
	import { weatherIconForCode } from '$lib/weatherCodes';
	import { formatDestination } from '$lib/tripDestination';
	import { formatCents } from '$lib/money';
	import { REMINDER_OFFSETS } from '$lib/reminderOffsets';
	import { segmentStatusLabel, segmentStatusClass } from '$lib/segmentStatus';
	import { tripStatusBadge } from '$lib/tripStatus';
	import { visibilityBadgeClass } from '$lib/visibility';
	import { coalesceTrailing, subscribeLiveEvents } from '$lib/liveEvents';
	import { onMount, tick } from 'svelte';
	import type { PageData, SubmitFunction } from './$types';
	import TripMap from '$lib/components/TripMap.svelte';
	import GlobeModal from '$lib/components/GlobeModal.svelte';
	import Autocomplete, { type AutocompleteSuggestion } from '$lib/components/Autocomplete.svelte';
	import { freeTextTravelerNames, peopleDetailMetaLines } from '$lib/segmentPeopleDisplay';
	import { segmentNotesRows } from '$lib/segmentDetailsDisplay';
	import TripDocumentsTable from '$lib/components/TripDocumentsTable.svelte';
	import Gallery from '$lib/components/Gallery.svelte';

	let { data, form }: { data: PageData; form?: { error?: string; errors?: Record<string, string> } } = $props();

	const { formatDate, formatDateTime, formatTime } = useDateFormat();

	type TripTab = 'itinerary' | 'prep' | 'money' | 'people' | 'notes' | 'documents';
	type TripTabLink = { id: TripTab; label: string; icon: IconName; count?: number | null; visible: boolean };
	type ViewMode = 'timeline' | 'list' | 'board';
	type SegmentPanelTab = 'details' | 'travelers' | 'notes' | 'files' | 'reminders';
	type DetailRow = { icon: IconName; label: string; value: string };
	type TripReminder = {
		id: number;
		kind: 'flight_checkin' | 'document_expiry' | 'custom';
		refType: 'segment' | 'document' | 'trip';
		refId: number;
		fireAt: string;
		status: 'pending' | 'sending' | 'sent';
		name: string | null;
		description: string | null;
		createdAt: string;
	};

	const TRIP_TAB_IDS = ['itinerary', 'prep', 'money', 'people', 'notes', 'documents'] as const;
	const VIEW_MODES: ViewMode[] = ['timeline', 'list', 'board'];
	const SEGMENT_PANEL_TABS: { id: SegmentPanelTab; label: string }[] = [
		{ id: 'details', label: 'Details' },
		{ id: 'travelers', label: 'Travelers' },
		{ id: 'notes', label: 'Notes' },
		{ id: 'files', label: 'Files' },
		{ id: 'reminders', label: 'Reminders' }
	];

	let globeOpen = $state(false);
	let editingId = $state<number | null>(null);
	let activeTab = $state<TripTab>('itinerary');
	let selectedTypes = $state<Set<SegmentType>>(new Set());
	let segmentQuery = $state('');
	let draggingSegmentId = $state<number | null>(null);
	let draggingSegmentDate = $state<string | null>(null);
	let dragOverDate = $state<string | null>(null);
	let moveSegmentDateForm = $state<HTMLFormElement | null>(null);
	let moveSegmentIdInput = $state<HTMLInputElement | null>(null);
	let moveTargetDateInput = $state<HTMLInputElement | null>(null);
	let deleteSegmentForm = $state<HTMLFormElement | null>(null);
	let deleteSegmentIdInput = $state<HTMLInputElement | null>(null);
	let posterFileInput = $state<HTMLInputElement | null>(null);
	let focusedSegmentId = $state<number | null>(null);
	let viewMode = $state<ViewMode>('timeline');
	let showTypeFilters = $state(false);
	let sortAscending = $state(true);
	let segmentPanelTab = $state<SegmentPanelTab>('details');
	let deleteSegmentTarget = $state<SegmentRow | null>(null);
	let reminderFeedback = $state<string | null>(null);
	let travelerCategory = $state('adult');
	let inviteTraveler = $state(false);
	let inviteEmail = $state('');
	let showDayNotes = $state(true);
	let editingDayNoteDate = $state<string | null>(null);
	let confirmingDayNoteDelete = $state<string | null>(null);

	const DAY_NOTE_ICONS: { name: IconName; label: string }[] = [
		{ name: 'document', label: 'Note' },
		{ name: 'info', label: 'Info' },
		{ name: 'warning', label: 'Warning' },
		{ name: 'star', label: 'Highlight' },
		{ name: 'reminder', label: 'Reminder' }
	];

	async function fetchRoamarrUsers(query: string): Promise<AutocompleteSuggestion[]> {
		const response = await fetch(`/trips/${data.trip.id}/people/users?q=${encodeURIComponent(query)}`);
		if (!response.ok) return [];
		return ((await response.json()) as { users: AutocompleteSuggestion[] }).users;
	}

	function updateTravelerCategory(value: string) {
		travelerCategory = value;
		if (value === 'guide' || value === 'driver') inviteTraveler = false;
	}

	function toggleType(type: SegmentType) {
		const next = new Set(selectedTypes);
		if (next.has(type)) next.delete(type);
		else next.add(type);
		selectedTypes = next;
	}

	function isTripTab(value: string | null | undefined): value is TripTab {
		return TRIP_TAB_IDS.includes(value as TripTab);
	}

	function selectTripTab(tab: TripTab) {
		activeTab = tab;
		if (typeof window === 'undefined') return;
		replaceState(`${window.location.pathname}${window.location.search}#${tab}`, {});
	}

	onMount(() => {
		const hashTab = window.location.hash.slice(1);
		if (isTripTab(hashTab)) activeTab = hashTab;

		// Live sync: another user/tab (or MCP client) mutating this trip pushes a
		// `trip` event over /api/events; coalesce bursts and refetch cheaply.
		const refresh = coalesceTrailing(() => {
			void invalidateAll();
		}, 500);
		const unsubscribe = subscribeLiveEvents((event) => {
			if (event.type === 'shares' || (event.type === 'trip' && event.id === data.trip.id)) {
				refresh.trigger();
			}
		});
		return () => {
			refresh.cancel();
			unsubscribe();
		};
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
		createdAt?: string | null;
		updatedAt?: string | null;
	};

	type SegmentRow = SharedSegment & {
		id?: number;
		startTz: string;
		endTz?: string | null;
		cardId?: number | null;
		paymentStatus?: string | null;
		paymentDueDate?: string | null;
		daySortOrder?: number | null;
	};

	const cardMap = $derived(new Map((data.cards ?? []).map((c) => [c.id, c])));
	const companionNameMap = $derived(new Map((data.companions ?? []).map((c) => [c.id, c.name])));
	const trip = $derived(data.trip);
	const isEditor = $derived(data.editor === true);
	const ownerTrip = $derived(data.owner === true ? (trip as Trip) : undefined);
	const posterUrl = $derived(trip.posterAttachmentId ? `/trips/${trip.id}/poster?v=${trip.posterAttachmentId}` : null);
	const baseCurrency = $derived(ownerTrip?.baseCurrency ?? (trip as Trip).baseCurrency ?? 'USD');
	const segmentList = $derived(
		isEditor ? (data.segments as SegmentRow[]) : ((data.trip as { segments: SharedSegment[] }).segments as SegmentRow[])
	);
	const reminderList = $derived((data.reminders ?? []) as TripReminder[]);
	const galleryImages = $derived(
		(data.gallery ?? []).map((image) => ({
			id: image.id,
			url: `/trips/${trip.id}/gallery/${image.id}`,
			caption: image.caption,
			filename: image.filename
		}))
	);

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

	function groupSegmentsByDay(segments: SegmentRow[], ascending = true) {
		const sorted = [...segments].sort((a, b) => {
			const aLocal = segmentLocalDateTime(a);
			const bLocal = segmentLocalDateTime(b);
			const aKey = aLocal?.toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS") ?? (a.startAt ?? '');
			const bKey = bLocal?.toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS") ?? (b.startAt ?? '');
			return ascending ? aKey.localeCompare(bKey) : bKey.localeCompare(aKey);
		});
		const groups: { key: string; label: string; segments: SegmentRow[] }[] = [];
		const index = new Map<string, number>();
		for (const s of sorted) {
			let key = 'unscheduled';
			let label = 'Unscheduled';
			const dt = segmentLocalDateTime(s);
			if (dt) {
				key = dt.toISODate()!;
				label = dt.toFormat('LLLL d, yyyy');
			}
			const existing = index.get(key);
			if (existing != null) groups[existing].segments.push(s);
			else {
				index.set(key, groups.length);
				groups.push({ key, label, segments: [s] });
			}
		}
		// Within a day: untimed (local-midnight) segments first, ordered by
		// daySortOrder (set by "Optimize order"; nulls keep natural order),
		// then timed segments in local-time order. See $lib/segmentDay.ts.
		for (const group of groups) {
			if (group.key === 'unscheduled') continue;
			const ordered = group.segments.slice().sort(compareSegmentsWithinDay);
			if (!ascending) ordered.reverse();
			group.segments = ordered;
		}
		return groups;
	}

	function untimedCoordSegments(group: { key: string; segments: SegmentRow[] }): SegmentRow[] {
		if (group.key === 'unscheduled') return [];
		return group.segments.filter(
			(s) =>
				s.cityLat != null &&
				s.cityLng != null &&
				isUntimedSegment(s.startAt ?? null, s.startTz)
		);
	}

	function dayCanOptimize(group: { key: string; segments: SegmentRow[] }): boolean {
		return untimedCoordSegments(group).length >= 2;
	}

	function dayDirectionsUrl(group: { key: string; segments: SegmentRow[] }): string | null {
		if (group.key === 'unscheduled') return null;
		return buildGoogleMapsDirectionsUrl(
			group.segments
				.filter((s) => s.cityLat != null && s.cityLng != null)
				.map((s) => ({ lat: s.cityLat!, lng: s.cityLng! }))
		);
	}

	function isInteractiveSegmentTarget(event: MouseEvent | KeyboardEvent) {
		const target = event.target;
		const current = event.currentTarget;
		if (!(target instanceof HTMLElement) || !(current instanceof HTMLElement)) return false;
		const interactive = target.closest('button, a, input, select, textarea, label, form, summary');
		return interactive instanceof HTMLElement && interactive !== current;
	}

	function handleSegmentCardClick(segment: SegmentRow, event: MouseEvent) {
		if (isInteractiveSegmentTarget(event)) return;
		if (segment.id != null) focusedSegmentId = segment.id;
	}

	function handleSegmentKeydown(segment: SegmentRow, event: KeyboardEvent) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		if (isInteractiveSegmentTarget(event)) return;
		event.preventDefault();
		if (segment.id != null) focusedSegmentId = segment.id;
	}

	function choosePoster() {
		if (isEditor) posterFileInput?.click();
	}

	function submitPoster(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files?.length) input.form?.requestSubmit();
	}

	function requestDeleteSegment(segment: SegmentRow) {
		deleteSegmentTarget = segment;
	}

	function confirmDeleteSegment() {
		if (deleteSegmentTarget?.id && deleteSegmentForm && deleteSegmentIdInput) {
			deleteSegmentIdInput.value = String(deleteSegmentTarget.id);
			deleteSegmentForm.requestSubmit();
		}
		deleteSegmentTarget = null;
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

	const refreshTripAction: SubmitFunction = () => {
		return async ({ result }) => {
			if (result.type === 'redirect' || result.type === 'success') {
				await invalidateAll();
				await tick();
				return;
			}
			await applyAction(result);
		};
	};

	const keepReminderTabAfterSubmit: SubmitFunction = () => {
		return async ({ result }) => {
			if (result.type === 'redirect' || result.type === 'success') {
				await invalidateAll();
				await tick();
				segmentPanelTab = 'reminders';
				reminderFeedback = 'Reminder saved.';
				return;
			}
			await applyAction(result);
		};
	};

	const dayNoteAction: SubmitFunction = () => {
		return async ({ result }) => {
			if (result.type === 'redirect' || result.type === 'success') {
				editingDayNoteDate = null;
				confirmingDayNoteDelete = null;
				await invalidateAll();
				await tick();
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

	const normalizedSegmentQuery = $derived(segmentQuery.trim().toLowerCase());
	const filteredSegmentList = $derived(
		segmentList.filter((s) => {
			if (selectedTypes.size > 0 && !selectedTypes.has(s.type as SegmentType)) return false;
			if (!normalizedSegmentQuery) return true;
			const hay = [s.title, s.location, s.cityName, s.venue, s.confirmationNumber, s.meetingPoint]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			return hay.includes(normalizedSegmentQuery);
		})
	);
	const dayGroups = $derived(groupSegmentsByDay(filteredSegmentList, sortAscending));
	const dayNotesByDate = $derived(new Map((data.dayNotes ?? []).map((n) => [n.date, n])));
	const days = $derived(tripDays(trip.startDate, trip.endDate));
	const daysUntil = $derived(daysUntilStart(trip.startDate));
	const status = $derived(tripStatus(trip.startDate, trip.endDate));
	const destinationLabel = $derived(formatDestination(trip.destinationCityName, trip.destinationCountryCode));
	const dateRangeText = $derived(formatTripRange(trip.startDate, trip.endDate));
	const selectedSegment = $derived(
		focusedSegmentId != null
			? (filteredSegmentList.find((s) => s.id === focusedSegmentId) ?? null)
			: null
	);
	const selectedAttendees = $derived(
		selectedSegment?.id != null ? (data.attendeesBySegment?.get(selectedSegment.id) ?? []) : []
	);
	const selectedDetailsPayload = $derived(readDetailsJson(selectedSegment));
	// Free-text passengers/tickets from import when structured segment_attendees is empty.
	const selectedFreeTextTravelers = $derived(freeTextTravelerNames(selectedDetailsPayload));
	const selectedDetailRows = $derived(selectedSegment ? segmentDetailRows(selectedSegment) : []);
	const selectedSegmentReminders = $derived(
		selectedSegment?.id != null
			? reminderList.filter((r) => r.refType === 'segment' && r.refId === selectedSegment.id)
			: []
	);
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
		(data.documentLinks?.length ?? 0) + (data.tripDocuments?.length ?? 0) + (data.policies?.length ?? 0) + (data.gallery?.length ?? 0)
	);
	const segmentTitleById = $derived(
		Object.fromEntries(
			segmentList.filter((s) => s.id != null).map((s) => [s.id as number, s.title])
		) as Record<number, string>
	);
	const selectedSegmentDocuments = $derived(
		selectedSegment?.id != null
			? (data.documentsBySegment?.get(selectedSegment.id) ??
					(data.tripDocuments ?? []).filter((d) => d.segmentId === selectedSegment.id))
			: []
	);
	const GPX_TRACK_COLORS = ['#e8590c', '#1971c2', '#2f9e44', '#7048e8', '#c2255c', '#f08c00', '#0ca678', '#868e96'];
	const gpxTracks = $derived.by(() => {
		const docs = (data.tripDocuments ?? []).filter((d) => d.contentType === 'application/gpx+xml');
		// Stable per-segment color assignment across the trip's GPX files.
		const segmentIds = [
			...new Set(docs.map((d) => d.segmentId).filter((s): s is number => s != null))
		].sort((a, b) => a - b);
		return docs.map((d) => ({
			url: `/trips/${trip.id}/documents/${d.id}`,
			label: d.label || d.filename,
			color:
				d.segmentId != null
					? GPX_TRACK_COLORS[segmentIds.indexOf(d.segmentId) % GPX_TRACK_COLORS.length]!
					: '#495057'
		}));
	});
	const hasPrepTab = $derived(isEditor || prepItemCount > 0);
	const hasMoneyTab = $derived(isEditor || moneyItemCount > 0 || data.budgets?.some((b) => b.amount != null) === true);
	const hasPeopleTab = $derived(isEditor || peopleItemCount > 0 || (data.owner === true && (data.emergencyContacts?.length ?? 0) > 0));
	const hasNotesTab = $derived(isEditor || notesItemCount > 0);
	const hasDocumentsTab = $derived(isEditor || documentsItemCount > 0 || (data.availablePolicies?.length ?? 0) > 0);
	const tripTabs = $derived(
		([
			{ id: 'itinerary', label: 'Itinerary', icon: 'calendar', count: segmentList.length, visible: true },
			{ id: 'prep', label: 'Prep', icon: 'check', count: prepItemCount, visible: hasPrepTab },
			{ id: 'money', label: 'Budget', icon: 'budget', count: moneyItemCount, visible: hasMoneyTab },
			{ id: 'people', label: 'People', icon: 'users', count: peopleItemCount, visible: hasPeopleTab },
			{ id: 'notes', label: 'Notes', icon: 'edit', count: notesItemCount, visible: hasNotesTab },
			{ id: 'documents', label: 'Documents', icon: 'document', count: documentsItemCount, visible: hasDocumentsTab }
		] satisfies TripTabLink[]).filter((tab) => tab.visible)
	);
	const EXPENSE_CATEGORIES = ['lodging', 'transport', 'food', 'activities', 'other'] as const;
	const categorySpending = $derived(
		EXPENSE_CATEGORIES.map((cat) => {
			const amount = (data.expenses ?? [])
				.filter((e) => e.category === cat)
				.reduce((sum, e) => sum + e.baseAmount, 0);
			return { category: cat, amount, label: cat.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase()) };
		})
			.filter((c) => c.amount > 0)
			.sort((a, b) => b.amount - a.amount)
	);
	const maxCategorySpend = $derived(Math.max(...categorySpending.map((c) => c.amount), 1));

	$effect(() => {
		if (!tripTabs.some((tab) => tab.id === activeTab)) activeTab = 'itinerary';
	});

	$effect(() => {
		if (focusedSegmentId != null && !filteredSegmentList.some((s) => s.id === focusedSegmentId)) {
			focusedSegmentId = filteredSegmentList[0]?.id ?? null;
		}
	});

	function formatTripRange(start: string | null | undefined, end: string | null | undefined) {
		if (!start && !end) return 'Flexible dates';
		const s = start ? DateTime.fromISO(start) : null;
		const e = end ? DateTime.fromISO(end) : null;
		if (s?.isValid && e?.isValid) {
			if (s.hasSame(e, 'day')) return s.toFormat('LLL d, yyyy');
			if (s.year === e.year && s.month === e.month) return `${s.toFormat('LLL d')} – ${e.toFormat('LLL d, yyyy')}`;
			if (s.year === e.year) return `${s.toFormat('LLL d')} – ${e.toFormat('LLL d, yyyy')}`;
			return `${s.toFormat('LLL d, yyyy')} – ${e.toFormat('LLL d, yyyy')}`;
		}
		const only = s?.isValid ? s : e?.isValid ? e : null;
		return only ? only.toFormat('LLL d, yyyy') : start || end || 'Flexible dates';
	}

	function groupWeekday(key: string) {
		if (key === 'unscheduled') return '';
		const dt = DateTime.fromISO(key);
		return dt.isValid ? dt.toFormat('cccc') : '';
	}

	function viewModeLabel(mode: ViewMode) {
		return mode[0].toUpperCase() + mode.slice(1);
	}

	function segmentTypeClass(type: string | null | undefined) {
		return `trip-modern-type-${String(type || 'other').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
	}

	function paymentStatusLabel(statusValue: string | null | undefined) {
		if (!statusValue) return null;
		return statusValue.replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());
	}

	function paymentStatusClass(statusValue: string | null | undefined) {
		return statusValue === 'fully_paid' || statusValue === 'deposit_paid' ? 'trip-modern-segment-status-paid' : 'trip-modern-segment-status-confirmed';
	}

	function segmentSideLabel(segment: SegmentRow) {
		if (segment.paymentStatus && segment.paymentStatus !== 'quoted') return paymentStatusLabel(segment.paymentStatus);
		if (segment.confirmationNumber) return 'Confirmed';
		return paymentStatusLabel(segment.paymentStatus);
	}

	function segmentSideClass(segment: SegmentRow) {
		if (segment.paymentStatus && segment.paymentStatus !== 'quoted') return paymentStatusClass(segment.paymentStatus);
		return segment.confirmationNumber ? 'trip-modern-segment-status-confirmed' : paymentStatusClass(segment.paymentStatus);
	}

	function segmentSubtitle(segment: SegmentRow) {
		const { place, address } = segmentPlaceLines(segment);
		if (place && address) return `${place} · ${address}`;
		return place ?? address ?? 'Location not set';
	}

	/** City/country on one line, venue/address on the next (selected-segment header). */
	function segmentPlaceLines(segment: SegmentRow): { place: string | null; address: string | null } {
		const place = [segment.cityName, segment.countryCode?.toUpperCase()].filter(Boolean).join(', ') || null;
		const address = (segment.venue?.trim() || segment.location?.trim() || '') || null;
		if (place && address && address !== place) return { place, address };
		if (place) return { place, address: null };
		if (address) return { place: null, address };
		return { place: 'Location not set', address: null };
	}

	function notesRowStacked(row: { label: string; value: string }) {
		const label = row.label.toLowerCase();
		if (label === 'notes' || label.endsWith(' notes') || label.includes('restriction')) return true;
		if (row.value.includes('\n')) return true;
		return row.value.length > 72;
	}

	function segmentMetaItems(segment: SegmentRow): { icon: IconName; value: string }[] {
		const details = readDetailsJson(segment);
		const items: { icon: IconName; value: string }[] = [];
		const detail = (key: string) => {
			const value = details[key];
			return typeof value === 'string' && value.trim() ? value.trim() : '';
		};
		const isFlight = segment.type === 'flight';
		// Airline (+ confirmation on the same line for flights so flight identity stays together).
		const airlineLine = [detail('airline'), detail('flightNumber')].filter(Boolean).join(' ');
		if (airlineLine) {
			const value =
				isFlight && segment.confirmationNumber
					? `${airlineLine} · Confirmation ${segment.confirmationNumber}`
					: airlineLine;
			items.push({ icon: 'flight', value });
		} else if (isFlight && segment.confirmationNumber) {
			items.push({ icon: 'document', value: `Confirmation ${segment.confirmationNumber}` });
		}
		if (segment.location && segment.venue && segment.location !== segment.venue) items.push({ icon: 'location', value: segment.location });
		for (const key of ['terminal', 'gate', 'seat', 'seats', 'room', 'checkIn']) {
			const value = detail(key);
			if (value) {
				const label = key === 'seats' || key === 'seat' ? `Seat(s) ${value}` : value;
				items.push({ icon: key === 'seat' || key === 'seats' ? 'user' : 'document', value: label });
			}
		}
		// Prefer tickets over passengers when both list the same people (email imports).
		for (const value of peopleDetailMetaLines(details)) {
			items.push({ icon: 'users', value });
		}
		for (const key of ['reservation', 'entry']) {
			const value = detail(key);
			if (value) items.push({ icon: key === 'entry' ? 'location' : 'document', value });
		}
		// Non-flight confirmations stay as their own meta line; flights already folded into airline.
		if (!isFlight && segment.confirmationNumber && !detail('reservation')) {
			items.push({ icon: 'document', value: `Confirmation ${segment.confirmationNumber}` });
		}
		// Flights: show arrival local time where the confirmation line used to be.
		if (isFlight && segment.endAt) {
			const endTz = segment.endTz ?? segment.startTz ?? 'UTC';
			const arrival = formatArrivalLocal(segment.endAt, endTz);
			if (arrival) items.push({ icon: 'reminder', value: arrival });
		}
		if (segment.meetingPoint) items.push({ icon: 'location', value: segment.meetingPoint });
		if (segment.meetingAt) items.push({ icon: 'reminder', value: `Meet ${formatTime(segment.meetingAt, segment.startTz ?? 'UTC')}` });
		const card = segment.cardId ? cardMap.get(segment.cardId) : null;
		if (card) items.push({ icon: 'card', value: `${card.nickname}${card.last4 ? ` ····${card.last4}` : ''}` });
		return items;
	}

	function readDetailsJson(segment: SegmentRow | null | undefined) {
		if (!segment?.detailsJson) return {} as Record<string, unknown>;
		try {
			const parsed = JSON.parse(segment.detailsJson) as unknown;
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
		} catch {
			return {} as Record<string, unknown>;
		}
	}

	const selectedNotesRows = $derived(segmentNotesRows(selectedDetailsPayload));
	const selectedPlaceLines = $derived(
		selectedSegment ? segmentPlaceLines(selectedSegment) : { place: null as string | null, address: null as string | null }
	);

	function segmentDetailRows(segment: SegmentRow): DetailRow[] {
		const rows: DetailRow[] = [];
		const local = segmentLocalDateTime(segment);
		const hotel = segment.type === 'hotel';
		const flight = segment.type === 'flight';
		const pickupDropoff = usesPickupDropoff(segment.type);
		if (local && segment.startAt) rows.push({ icon: 'calendar', label: hotel ? 'Check-in' : flight ? 'Departure' : pickupDropoff ? 'Pick-up' : 'Date & time', value: `${formatDate(local.toISODate()!)} · ${formatTime(segment.startAt, segment.startTz ?? 'UTC')}` });
		else rows.push({ icon: 'calendar', label: hotel ? 'Check-in' : flight ? 'Departure' : pickupDropoff ? 'Pick-up' : 'Date & time', value: 'Unscheduled' });
		if ((hotel || flight || pickupDropoff) && segment.endAt) {
			const endTz = segment.endTz ?? segment.startTz ?? 'UTC';
			const end = DateTime.fromISO(segment.endAt, { zone: 'utc' }).setZone(endTz);
			rows.push({ icon: 'calendar', label: hotel ? 'Check-out' : flight ? 'Arrival' : 'Drop-off', value: `${formatDate(end.toISODate()!)} · ${formatTime(segment.endAt, endTz)}` });
		}
		const location = segmentSubtitle(segment);
		if (location) rows.push({ icon: 'location', label: 'Location', value: location });
		const duration = formatSegmentDuration(segment.startAt, segment.endAt);
		if (duration) rows.push({ icon: 'reminder', label: 'Duration', value: duration });
		if (segment.confirmationNumber) rows.push({ icon: 'document', label: 'Booking ref', value: segment.confirmationNumber });
		if (segment.meetingPoint) rows.push({ icon: 'location', label: 'Meeting point', value: segment.meetingPoint });
		if (segment.paymentStatus) rows.push({ icon: 'budget', label: 'Payment', value: paymentStatusLabel(segment.paymentStatus) ?? segment.paymentStatus });
		const card = segment.cardId ? cardMap.get(segment.cardId) : null;
		if (card) rows.push({ icon: 'card', label: 'Payment card', value: `${card.nickname}${card.last4 ? ` ····${card.last4}` : ''}` });
		return rows;
	}

	function selectedCreatorName() {
		return data.user?.displayName ?? 'you';
	}

	function formatCreatedDate(value: string) {
		const dt = DateTime.fromISO(value);
		return dt.isValid ? formatDate(dt.toISODate()!) : value;
	}

	function weatherDayChip(date: string) {
		const dt = DateTime.fromISO(date);
		return dt.isValid ? dt.toFormat('EEE, MMM d') : date;
	}

	function formatUpdatedDate(value: string) {
		const dt = DateTime.fromISO(value);
		if (!dt.isValid) return value;
		if (dt.hasSame(DateTime.now(), 'day')) return `today at ${dt.toFormat('h:mm a')}`;
		return formatDateTime(value);
	}

	function reminderKindLabel(kind: TripReminder['kind']) {
		if (kind === 'flight_checkin') return 'Flight check-in';
		if (kind === 'document_expiry') return 'Document expiry';
		return 'Custom reminder';
	}
</script>

<div class="trip-detail trip-modern">
	<section class="trip-hero {data.nextCity && data.tileConfig ? 'trip-hero--map' : ''}">
		<div class="trip-hero-backdrop"></div>
		{#if data.nextCity && data.tileConfig}
			<div class="trip-hero-map-layer">
				<TripMap fill lat={data.nextCity.lat} lng={data.nextCity.lng} cityName={data.nextCity.cityName} tileUrls={data.tileConfig.tileUrls} attribution={data.tileConfig.attribution} tracks={gpxTracks} onExpand={() => (globeOpen = true)} />
			</div>
			<div class="trip-hero-map-scrim"></div>
		{/if}
		<div class="trip-hero-scrim"></div>

		<div class="trip-hero-content relative px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
			<a href="/trips" class="back-link"><Icon name="back" class="h-4 w-4" />Back to trips</a>
			<div class="flex flex-col gap-6 sm:flex-row sm:items-end">
				<form method="POST" action="?/uploadTripPoster" enctype="multipart/form-data" class="trip-poster-form">
					<button type="button" class="trip-poster {posterUrl ? 'trip-poster--image' : ''} grid place-items-center" onclick={choosePoster} disabled={!isEditor} aria-label={isEditor ? (posterUrl ? 'Replace trip poster image' : 'Upload trip poster image') : 'Trip poster'}>
						{#if posterUrl}
							<img src={posterUrl} alt="" class="trip-poster-img" />
							{#if isEditor}<span class="trip-poster-upload-chip"><Icon name="upload" class="h-3.5 w-3.5" />Replace</span>{/if}
						{:else}
							<div class="text-center"><Icon name={isEditor ? 'upload' : 'location'} class="trip-poster-icon mx-auto h-8 w-8" /><p class="trip-poster-initials mt-2 font-display text-2xl font-bold">{isEditor ? 'Upload' : posterInitials(trip.name, trip.destinationCityName)}</p></div>
						{/if}
					</button>
					{#if isEditor}<input bind:this={posterFileInput} type="file" name="file" accept="image/jpeg,image/png,image/webp" class="sr-only" onchange={submitPoster} />{/if}
				</form>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						{#if !isEditor}<span class="badge badge-brand badge-compact">Shared view</span>{/if}
						<span class="badge badge-compact {tripStatusBadge(status).class}">{tripStatusBadge(status).label}</span>
						{#if ownerTrip}<span class="badge badge-compact {visibilityBadgeClass(ownerTrip.defaultVisibility)} capitalize">{ownerTrip.defaultVisibility}</span>{/if}
					</div>
					<h1 class="trip-hero-title mt-2 text-3xl font-extrabold sm:text-4xl">{trip.name}</h1>
					<div class="mt-3 flex flex-wrap gap-2">
						{#if destinationLabel}<span class="badge badge-brand"><Icon name="location" class="h-3.5 w-3.5" />{destinationLabel}</span>{/if}
						{#if trip.startDate || trip.endDate}<span class="badge badge-brand"><span class="font-mono leading-none">{trip.startDate || '—'}</span><Icon name="arrow-right" class="h-3.5 w-3.5" /><span class="font-mono leading-none">{trip.endDate || '—'}</span></span>{/if}
						{#if days}<span class="badge badge-brand">{days} day{days === 1 ? '' : 's'}</span>{/if}
						{#if daysUntil != null}<span class="badge badge-brand">Starts in {daysUntil} day{daysUntil === 1 ? '' : 's'}</span>{/if}
						<span class="badge badge-brand">{segmentList.length} segment{segmentList.length === 1 ? '' : 's'}</span>
					</div>
				</div>
				<div class="flex justify-end sm:self-end">
					<details class="app-user-menu relative">
						<summary class="app-user-summary btn btn-primary flex cursor-pointer list-none items-center gap-2" aria-label="Trip actions"><Icon name="more-horizontal" class="h-4 w-4" /><span>Actions</span></summary>
						<div class="app-user-menu-panel absolute right-0 top-[calc(100%+0.5rem)] z-30 w-64 overflow-hidden rounded-lg border shadow-2xl"><div class="p-2">
							{#if isEditor}<a href={`/trips/${trip.id}/edit`} class="app-user-menu-item"><Icon name="edit" class="h-4.5 w-4.5" /><span>Edit Trip</span></a>{/if}
							{#if data.owner === true}<form method="POST" action="?/toggleFavorite"><button class="app-user-menu-item app-user-menu-button w-full" type="submit"><Icon name="star" class="h-4.5 w-4.5" /><span>{trip.favorite ? 'Favorited' : 'Favorite'}</span></button></form><a href={`/trips/${trip.id}/share`} class="app-user-menu-item"><Icon name="share" class="h-4.5 w-4.5" /><span>Share</span></a>{#if data.publicShareUrl}<CopyButton text={data.publicShareUrl} class="app-user-menu-item app-user-menu-button w-full" label="Copy public link" icon="copy" />{/if}{/if}
							<a href={`/trips/${trip.id}/print`} class="app-user-menu-item"><Icon name="print" class="h-4.5 w-4.5" /><span>Print</span></a>
							<a href={`/trips/${trip.id}/calendar`} class="app-user-menu-item"><Icon name="calendar" class="h-4.5 w-4.5" /><span>Calendar</span></a>
							{#if isEditor}<form method="POST" action="?/duplicate"><button class="app-user-menu-item app-user-menu-button w-full" type="submit"><Icon name="duplicate" class="h-4.5 w-4.5" /><span>Duplicate</span></button></form>{/if}
							{#if data.owner === true}<form method="POST" action="?/markVisitedPlaces"><button class="app-user-menu-item app-user-menu-button w-full" type="submit"><Icon name="location" class="h-4.5 w-4.5" /><span>Mark Places Visited</span></button></form><form method="POST" action="?/toggleArchive"><button class="app-user-menu-item app-user-menu-button w-full" type="submit"><Icon name="archive" class="h-4.5 w-4.5" /><span>{trip.archived ? 'Unarchive' : 'Archive'}</span></button></form>{/if}
						</div></div>
					</details>
				</div>
			</div>
		</div>
	</section>

	{#if form?.error}<p class="notice notice-error trip-detail-body mt-6">{form.error}</p>{/if}
	{#if data.nextCity && data.tileConfig}<GlobeModal bind:open={globeOpen} lat={data.nextCity.lat} lng={data.nextCity.lng} cityName={data.nextCity.cityName} />{/if}

	<div class="trip-modern-workspace">
		<div class="trip-modern-tabs-wrap"><nav class="trip-modern-tabs" aria-label="Trip sections">{#each tripTabs as tab (tab.id)}<button id={`trip-tab-${tab.id}`} type="button" aria-current={activeTab === tab.id ? 'page' : undefined} class="trip-modern-tab {activeTab === tab.id ? 'trip-modern-tab-active' : ''}" onclick={() => selectTripTab(tab.id)}><Icon name={tab.icon} class="h-4 w-4" /><span>{tab.label}</span>{#if tab.count != null && tab.count > 0}<span class="trip-modern-tab-count">{tab.count}</span>{/if}</button>{/each}</nav></div>

		{#if activeTab === 'itinerary'}
			<div class="trip-modern-toolbar">
				<div class="trip-modern-control" aria-label="Trip date range"><span class="inline-flex items-center gap-2"><Icon name="calendar" class="h-4 w-4" /><span>{dateRangeText}</span></span><Icon name="chevron-down" class="h-4 w-4" /></div>
				<label class="trip-modern-search"><Icon name="search" class="h-4.5 w-4.5" /><span class="sr-only">Search itinerary</span><input type="search" placeholder="Search itinerary…" bind:value={segmentQuery} /></label>
				<div class="trip-modern-toolbar-actions"><button type="button" class="trip-modern-control" onclick={() => (showTypeFilters = !showTypeFilters)}><Icon name="settings" class="h-4 w-4" /><span>Filters</span></button><button type="button" class="trip-modern-control" onclick={() => (sortAscending = !sortAscending)}><span>{sortAscending ? '↑↓' : '↓↑'}</span><span>Sort</span></button><button type="button" class="trip-modern-control" aria-pressed={showDayNotes} onclick={() => (showDayNotes = !showDayNotes)}><Icon name="document" class="h-4 w-4" /><span>Day notes</span></button><div class="trip-modern-view-toggle" aria-label="Itinerary view">{#each VIEW_MODES as mode}<button type="button" class="trip-modern-view-button {viewMode === mode ? 'trip-modern-view-button-active' : ''}" onclick={() => (viewMode = mode)}><Icon name={mode === 'timeline' ? 'trips' : mode === 'list' ? 'document' : 'card'} class="h-4 w-4" /><span>{viewModeLabel(mode)}</span></button>{/each}</div>{#if isEditor}<a href={`/trips/${trip.id}/segments/new`} class="btn btn-primary flex items-center gap-2"><Icon name="plus" class="h-4 w-4" /><span>Add segment</span></a>{/if}</div>
			</div>
			{#if showTypeFilters && typeCounts.length}<div class="trip-modern-filter-row" aria-label="Filter plans by type">{#each typeCounts as t (t.type)}{@const active = selectedTypes.has(t.type)}<button type="button" class="trip-modern-filter-chip {active ? 'trip-modern-filter-chip-active' : ''}" onclick={() => toggleType(t.type)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">{@html SEG[t.type].icon}</svg><span>{SEG[t.type].label}</span><span class="font-mono">{t.count}</span></button>{/each}{#if selectedTypes.size}<button type="button" class="trip-modern-filter-chip" onclick={() => (selectedTypes = new Set())}>Clear filters</button>{/if}</div>{/if}
			{#if isEditor}<form method="POST" action="?/moveSegmentDate" class="hidden" bind:this={moveSegmentDateForm} use:enhance={preserveScrollOnMove}><input type="hidden" name="segmentId" bind:this={moveSegmentIdInput} /><input type="hidden" name="targetDate" bind:this={moveTargetDateInput} /></form><form method="POST" action={`/trips/${trip.id}/segments?/delete`} class="hidden" bind:this={deleteSegmentForm} use:enhance={refreshTripAction}><input type="hidden" name="segmentId" bind:this={deleteSegmentIdInput} /></form>{/if}

			<div class="trip-modern-content">
				<main class="trip-modern-main trip-modern-main-{viewMode}" id="trip-panel-itinerary">
					{#if ownerTrip?.notes}<section class="trip-modern-panel"><div class="trip-modern-panel-head"><h2 class="trip-modern-panel-title">Overview</h2></div><MarkdownText text={ownerTrip.notes} class="prose prose-invert max-w-none text-sm leading-relaxed text-slate-300" /></section>{/if}
					{#if data.weather && data.weather.days.length > 0}
						{@const weather = data.weather}
						<section class="trip-modern-panel" aria-label="Trip weather">
							<div class="trip-modern-panel-head"><h2 class="trip-modern-panel-title">Weather</h2></div>
							{#if weather.advisory}<p class="notice notice-warning mb-3">{weather.advisory}</p>{/if}
							<div class="flex flex-wrap gap-2">
								{#each weather.days as day (day.date)}
									{@const icon = weatherIconForCode(day.code)}
									<div class="badge badge-brand" title={day.locationLabel ? `${day.summary} — ${day.locationLabel}` : day.summary}>
										{#if icon}<Icon name={icon} class="h-3.5 w-3.5" />{/if}
										<span>{weatherDayChip(day.date)}</span>
										{#if day.tempMax != null && day.tempMin != null}<span class="font-mono">{Math.round(day.tempMax)}{weather.tempUnit} / {Math.round(day.tempMin)}{weather.tempUnit}</span>{:else}<span>{day.summary}</span>{/if}
										{#if day.typical}<span class="text-xs opacity-70">typical</span>{:else if day.degraded}<span class="text-xs opacity-70">stale</span>{/if}
									</div>
								{/each}
							</div>
						</section>
					{/if}
					{#if dayGroups.length}
						{#each dayGroups as group (group.key)}
							<section class="trip-modern-day-card {dragOverDate === group.key ? 'trip-modern-drop-target' : ''}" aria-label={`${group.label} itinerary plans`} ondragover={(e) => allowDayDrop(e, group.key)} ondragenter={(e) => allowDayDrop(e, group.key)} ondragleave={(e) => leaveDayDrop(e, group.key)} ondrop={(e) => dropSegmentOnDay(e, group.key)}>
								<header class="trip-modern-day-head"><div class="trip-modern-day-title"><Icon name="calendar" class="h-5 w-5" /><div><h2 class="trip-modern-day-date">{group.label}</h2>{#if groupWeekday(group.key)}<p class="trip-modern-day-weekday">{groupWeekday(group.key)}</p>{/if}</div></div><div class="flex items-center gap-3">{#if isEditor && dayCanOptimize(group)}<form method="POST" action="?/optimizeTripDay" use:enhance={preserveScrollOnMove}><input type="hidden" name="date" value={group.key} /><button type="submit" class="trip-modern-day-plus" title="Optimize order" aria-label={`Optimize stop order for ${group.label}`}><Icon name="trips" class="h-4 w-4" /></button></form>{/if}{#if dayDirectionsUrl(group)}<a href={dayDirectionsUrl(group)!} target="_blank" rel="noopener noreferrer" class="trip-modern-day-plus" title="Open in Google Maps" aria-label={`Open ${group.label} in Google Maps`}><Icon name="location" class="h-4 w-4" /></a>{/if}<span class="trip-modern-day-count">{group.segments.length} segment{group.segments.length === 1 ? '' : 's'}</span>{#if isEditor}<a href={`/trips/${trip.id}/segments/new`} class="trip-modern-day-plus" aria-label="Add segment"><Icon name="plus" class="h-4 w-4" /></a>{/if}</div></header>
								{#if group.key !== 'unscheduled' && showDayNotes}
									{@const note = dayNotesByDate.get(group.key)}
									{#if isEditor && editingDayNoteDate === group.key}
										<div class="trip-modern-day-note-editor">
											<form method="POST" action="?/setDayNote" use:enhance={dayNoteAction}>
												<input type="hidden" name="date" value={group.key} />
												<select name="icon" class="input input-compact w-auto text-sm" aria-label="Day note icon" value={note?.icon ?? ''}>
													<option value="">No icon</option>
													{#each DAY_NOTE_ICONS as opt (opt.name)}<option value={opt.name}>{opt.label}</option>{/each}
												</select>
												<textarea name="body" rows="3" maxlength="10000" class="input text-sm" placeholder="Add a note for this day…" required>{note?.body ?? ''}</textarea>
											<p class="field-help">Markdown supported</p>
												<div class="flex items-center gap-2">
													<button class="btn btn-primary btn-sm">Save note</button>
													<button type="button" class="btn btn-secondary btn-sm" onclick={() => (editingDayNoteDate = null)}>Cancel</button>
												</div>
											</form>
											{#if note}
												{#if confirmingDayNoteDelete === group.key}
													<form method="POST" action="?/deleteDayNote" use:enhance={dayNoteAction} class="mt-2 flex items-center gap-2">
														<input type="hidden" name="date" value={group.key} />
														<span class="trip-modern-panel-muted text-sm">Delete this day note?</span>
														<button class="btn btn-danger btn-sm">Delete</button>
														<button type="button" class="btn btn-secondary btn-sm" onclick={() => (confirmingDayNoteDelete = null)}>Keep</button>
													</form>
												{:else}
													<button type="button" class="btn btn-secondary btn-sm mt-2" onclick={() => (confirmingDayNoteDelete = group.key)}>Delete note</button>
												{/if}
											{/if}
										</div>
									{:else if note}
										<div class="trip-modern-day-note">
											{#if note.icon}<Icon name={note.icon} class="mt-0.5 h-4 w-4 shrink-0" />{/if}
											<MarkdownText text={note.body} class="text-sm" />
											{#if isEditor}<button type="button" class="trip-modern-day-note-edit" aria-label="Edit day note" onclick={() => (editingDayNoteDate = group.key)}><Icon name="edit" class="h-3.5 w-3.5" /></button>{/if}
										</div>
									{:else if isEditor}
										<button type="button" class="trip-modern-day-note-add" onclick={() => (editingDayNoteDate = group.key)}><Icon name="plus" class="h-3.5 w-3.5" />Add day note</button>
									{/if}
								{/if}
								<div class="trip-modern-day-body" class:trip-modern-day-body-editing={group.segments.some((segment) => segment.id === editingId)}>
									{#each group.segments as s, i (s.id ?? `${group.key}-${i}`)}
										{@const duration = formatSegmentDuration(s.startAt, s.endAt)}
										{@const sideLabel = segmentSideLabel(s)}
										{@const metaItems = segmentMetaItems(s)}
										{#if isEditor && editingId === s.id}
											{@const editDocs = s.id != null ? (data.documentsBySegment?.get(s.id) ?? (data.tripDocuments ?? []).filter((d) => d.segmentId === s.id)) : []}
											<SegmentEditForm segment={s} tripId={trip.id} errors={form?.errors ?? {}} cards={data.cards ?? []} documents={editDocs} onCancel={() => (editingId = null)} />
										{:else}
											<button type="button" class="trip-modern-segment {segmentTypeClass(s.type)} {selectedSegment?.id != null && selectedSegment.id === s.id ? 'trip-modern-segment-active' : ''} {draggingSegmentId === s.id ? 'trip-modern-segment-dragging' : ''}" onclick={(e) => handleSegmentCardClick(s, e)} onkeydown={(e) => handleSegmentKeydown(s, e)} draggable={isEditor && s.id != null} ondragstart={(e) => s.id != null && startSegmentDrag(s.id, group.key, e)} ondragend={endSegmentDrag}>
												<div class="trip-modern-time">
													{#if s.startAt}
														<div class="trip-modern-time-main">{formatTime(s.startAt, s.startTz ?? 'UTC')}</div>
														{#if s.type === 'flight'}
															{@const zoneLabel = formatZoneLabel(s.startAt, s.startTz ?? 'UTC')}
															{#if zoneLabel}<div class="trip-modern-time-zone">{zoneLabel}</div>{/if}
														{/if}
													{:else}
														<div class="trip-modern-time-main">TBD</div>
													{/if}
													{#if duration}<div class="trip-modern-time-duration">{duration}</div>{/if}
												</div>
												<span class="trip-modern-type-node" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">{@html SEG[s.type as keyof typeof SEG]?.icon ?? ''}</svg></span>
												<div class="trip-modern-segment-body"><div class="trip-modern-segment-head"><h3 class="trip-modern-segment-title">{s.title}</h3>{#if s.status}<span class="trip-modern-segment-status {segmentStatusClass(s.status)}">{segmentStatusLabel(s.status)}</span>{/if}</div><p class="trip-modern-segment-subtitle">{segmentSubtitle(s)}</p>{#if metaItems.length}<div class="trip-modern-segment-meta">{#each metaItems as item, metaIndex}<span class="trip-modern-meta-pill"><Icon name={item.icon} class="h-3.5 w-3.5" /><span>{item.value}</span></span>{#if metaIndex < metaItems.length - 1}<span class="trip-modern-meta-separator">•</span>{/if}{/each}</div>{/if}</div>
												<div class="trip-modern-segment-side">{#if sideLabel}<span class="trip-modern-segment-status {segmentSideClass(s)}">{sideLabel}</span>{/if}<Icon name="chevron-down" class="trip-modern-chevron h-5 w-5 -rotate-90" /></div>
											</button>
										{/if}
									{/each}
								</div>
							</section>
						{/each}
					{:else}<div class="trip-modern-empty">No itinerary segments match your filters.</div>{/if}
				</main>

				<aside class="trip-modern-side-panel" class:trip-modern-side-panel-open={selectedSegment} aria-label="Selected segment details" role={selectedSegment ? 'dialog' : undefined} aria-modal={selectedSegment ? 'true' : undefined}>
					{#if selectedSegment}
						<header class="trip-modern-selected-head"><h2 class="trip-modern-selected-title">Selected segment</h2><button type="button" class="icon-button icon-button-sm" aria-label="Close selected segment" onclick={() => (focusedSegmentId = null)}><Icon name="close" class="h-4 w-4" /></button></header>
						<div class="trip-modern-selected-summary {segmentTypeClass(selectedSegment.type)}"><span class="trip-modern-selected-node" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{@html SEG[selectedSegment.type as keyof typeof SEG]?.icon ?? ''}</svg></span><div class="min-w-0 flex-1"><h3 class="trip-modern-selected-name">{selectedSegment.title}</h3><div class="mt-2 flex flex-wrap gap-1.5">{#if selectedSegment.status}<span class="badge badge-compact {segmentStatusClass(selectedSegment.status)}">{segmentStatusLabel(selectedSegment.status)}</span>{/if}{#if selectedSegment.paymentStatus}<span class="badge badge-compact badge-green">{paymentStatusLabel(selectedSegment.paymentStatus)}</span>{/if}</div>{#if selectedPlaceLines.place}<p class="trip-modern-selected-place">{selectedPlaceLines.place}</p>{/if}{#if selectedPlaceLines.address}<p class="trip-modern-selected-address">{selectedPlaceLines.address}</p>{/if}</div></div>
						<nav class="trip-modern-detail-tabs" aria-label="Selected segment sections">{#each SEGMENT_PANEL_TABS as tab (tab.id)}<button type="button" class="trip-modern-detail-tab {segmentPanelTab === tab.id ? 'trip-modern-detail-tab-active' : ''}" onclick={() => (segmentPanelTab = tab.id)}>{tab.label}{#if tab.id === 'travelers' && (selectedAttendees.length || selectedFreeTextTravelers.length)} ({selectedAttendees.length || selectedFreeTextTravelers.length}){/if}{#if tab.id === 'files' && selectedSegmentDocuments.length} ({selectedSegmentDocuments.length}){/if}{#if tab.id === 'reminders' && selectedSegmentReminders.length} ({selectedSegmentReminders.length}){/if}</button>{/each}</nav>

						{#if segmentPanelTab === 'details'}<div class="trip-modern-detail-list">{#each selectedDetailRows as row (row.label)}<div class="trip-modern-detail-row"><Icon name={row.icon} class="trip-modern-detail-icon h-4 w-4" /><span class="trip-modern-detail-label">{row.label}</span><span class="trip-modern-detail-value">{row.value}</span></div>{/each}</div>{:else if segmentPanelTab === 'travelers'}<div class="trip-modern-detail-list">{#if selectedAttendees.length}{#each selectedAttendees as a (a.id)}<div class="trip-modern-list-row"><span>{a.name}</span><span class="badge badge-compact {a.status === 'going' ? 'badge-green' : a.status === 'maybe' ? 'badge-amber' : 'badge-slate'} capitalize">{a.status.replace('_', ' ')}</span></div>{/each}{:else if selectedFreeTextTravelers.length}{#each selectedFreeTextTravelers as name (name)}<div class="trip-modern-list-row"><span>{name}</span><span class="badge badge-compact badge-slate">listed</span></div>{/each}<p class="trip-modern-panel-muted text-sm mt-2">From booking details (not linked as trip people).</p>{:else}<p class="trip-modern-empty">No travelers assigned to this segment.</p>{/if}</div>{:else if segmentPanelTab === 'notes'}<div class="trip-modern-detail-list">{#if selectedNotesRows.length}{#each selectedNotesRows as row (row.label)}{@const stacked = notesRowStacked(row)}<div class="trip-modern-list-row trip-modern-kv-row {stacked ? 'trip-modern-kv-row-stacked' : ''}"><span class="trip-modern-kv-label">{row.label}</span>{#if row.label === 'Notes'}<span class="trip-modern-kv-value"><MarkdownText text={row.value} /></span>{:else}<span class="trip-modern-kv-value">{row.value}</span>{/if}</div>{/each}{:else}<p class="trip-modern-empty">No extra notes for this segment.</p>{/if}</div>{:else if segmentPanelTab === 'files'}<div class="trip-modern-detail-list"><TripDocumentsTable tripId={trip.id} documents={selectedSegmentDocuments} canEdit={isEditor} pageSize={5} showScope={false} compact={true} emptyMessage="No files attached to this segment." />{#if isEditor && selectedSegment.id}<form method="POST" action="?/uploadTripDocument" enctype="multipart/form-data" class="trip-modern-reminder-card mt-3"><input type="hidden" name="segmentId" value={selectedSegment.id} /><label class="label" for="segment-doc-file">Upload PDF or image</label><input id="segment-doc-file" type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" class="input text-sm" required /><input name="label" class="input text-sm" placeholder="Label (optional)" /><button class="btn btn-primary btn-sm"><Icon name="upload" class="h-4 w-4" />Upload file</button></form>{/if}</div>{:else}<div class="trip-modern-detail-list">{#if reminderFeedback}<p class="notice notice-success">{reminderFeedback}</p>{/if}{#if selectedSegmentReminders.length}<div class="trip-modern-list">{#each selectedSegmentReminders as r (r.id)}<div class="trip-modern-list-row"><div><strong>{reminderKindLabel(r.kind)}</strong><p class="trip-modern-panel-muted text-sm">{formatDateTime(r.fireAt)}</p></div><span class="badge badge-compact {r.status === 'pending' ? 'badge-green' : r.status === 'sending' ? 'badge-amber' : 'badge-slate'} capitalize">{r.status}</span></div>{/each}</div>{:else}<p class="trip-modern-empty">No reminders for this segment yet.</p>{/if}{#if isEditor && selectedSegment.id}<form method="POST" action="?/segmentReminder" class="trip-modern-reminder-card" use:enhance={keepReminderTabAfterSubmit}><input type="hidden" name="segmentId" value={selectedSegment.id} /><label class="label" for="selected-reminder-offset">Remind me before this segment</label><select id="selected-reminder-offset" name="offsetMinutes" class="input text-sm">{#each REMINDER_OFFSETS.filter((o) => o.minutes <= 1440) as offset}<option value={offset.minutes}>{offset.label}</option>{/each}</select><button class="btn btn-primary btn-sm"><Icon name="notification" class="h-4 w-4" />Save reminder</button></form>{/if}</div>{/if}

						{#if isEditor && selectedSegment.id}<div class="trip-modern-selected-actions"><button type="button" class="btn btn-primary" onclick={() => { editingId = selectedSegment.id ?? null; focusedSegmentId = null; }}><Icon name="edit" class="h-4 w-4" />Edit</button><form method="POST" action="?/duplicateSegment" use:enhance={refreshTripAction}><input type="hidden" name="segmentId" value={selectedSegment.id} /><button class="btn btn-secondary"><Icon name="duplicate" class="h-4 w-4" />Duplicate</button></form>{#if selectedSegment.type === 'poi'}<form method="POST" action="?/saveSegmentToPlace" use:enhance={refreshTripAction}><input type="hidden" name="segmentId" value={selectedSegment.id} /><button class="btn btn-secondary"><Icon name="location" class="h-4 w-4" />Save to places</button></form>{/if}<button type="button" class="btn btn-danger" onclick={() => requestDeleteSegment(selectedSegment)}><Icon name="close" class="h-4 w-4" />Delete</button><button type="button" class="btn btn-secondary" onclick={() => (segmentPanelTab = 'reminders')}><Icon name="notification" class="h-4 w-4" />Add reminder</button></div>{/if}
						{#if selectedSegment.createdAt || selectedSegment.updatedAt}<p class="trip-modern-selected-footer">{#if selectedSegment.createdAt}<span>Created by {selectedCreatorName()} on {formatCreatedDate(selectedSegment.createdAt)}</span>{/if}{#if selectedSegment.createdAt && selectedSegment.updatedAt}<span> · </span>{/if}{#if selectedSegment.updatedAt}<span>Updated {formatUpdatedDate(selectedSegment.updatedAt)}</span>{/if}</p>{/if}
					{:else}<div class="trip-modern-selected-empty"><div><Icon name="trips" class="mx-auto mb-3 h-8 w-8" /><p>Select a segment to see its details.</p></div></div>{/if}
				</aside>
			</div>
		{:else if activeTab === 'prep'}
			<section class="trip-modern-panel"><div class="trip-modern-panel-head"><h2 class="trip-modern-panel-title">Prep</h2><span class="badge badge-slate badge-compact">{prepItemCount} item{prepItemCount === 1 ? '' : 's'}</span></div>{#if data.checklist?.items?.length}<div class="trip-modern-list">{#each data.checklist.items as item (item.id)}<div class="trip-modern-list-row"><form method="POST" action="?/toggleChecklistItem" class="flex min-w-0 items-center gap-3"><input type="hidden" name="itemId" value={item.id} /><button class="check-toggle" type="submit"><span class="check-marker {item.packed ? 'check-marker-active' : ''}"><Icon name="check" class="h-3.5 w-3.5" /></span><span class="check-label {item.packed ? 'check-label-done' : ''}">{item.text}</span></button></form>{#if item.assignedToName}<span class="badge badge-slate badge-compact">{item.assignedToName}</span>{/if}</div>{/each}</div>{:else}<p class="trip-modern-empty">No prep items yet.</p>{/if}{#if isEditor}<form method="POST" action="?/addChecklistItem" class="trip-modern-form-inline"><input name="text" class="input flex-1 text-sm" placeholder="Add checklist item" required /><select name="assignedToCompanionId" class="input w-auto text-sm"><option value="">Unassigned</option>{#each data.companions ?? [] as c (c.id)}<option value={c.id}>{c.name}</option>{/each}</select><button class="btn btn-primary btn-sm">Add item</button></form>{/if}</section>
		{:else if activeTab === 'money'}
			<section class="trip-modern-panel">
				<div class="trip-modern-panel-head"><h2 class="trip-modern-panel-title">Budget & expenses</h2>{#if data.expenses?.length}<button type="button" class="btn btn-secondary btn-sm" onclick={exportExpensesCsv}>Export CSV</button>{/if}</div>
				<div class="grid gap-3 md:grid-cols-3"><div class="metric-card"><span class="metric-label">Expenses</span><p class="metric-value">{formatCents(data.stats?.totalExpenses ?? 0, data.stats?.totalExpensesCurrency ?? baseCurrency)}</p></div><div class="metric-card"><span class="metric-label">Budget cap</span><p class="metric-value">{formatCents(data.stats?.budgetCap ?? 0, baseCurrency)}</p></div><div class="metric-card"><span class="metric-label">Paid segments</span><p class="metric-value">{data.stats?.paidSegments ?? 0}/{data.stats?.totalSegments ?? segmentList.length}</p></div></div>
				{#if categorySpending.length}<div class="mt-5 trip-modern-list">{#each categorySpending as c (c.category)}<div class="trip-modern-list-row"><span>{c.label}</span><div class="min-w-0 flex flex-1 items-center gap-3"><div class="progress-track"><div class="progress-fill" style="width: {Math.round((c.amount / maxCategorySpend) * 100)}%;"></div></div><span class="font-mono text-sm">{formatCents(c.amount, baseCurrency)}</span></div></div>{/each}</div>{/if}
				{#if data.budgets?.length}
					<div class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
						{#each data.budgets as budget (budget.category)}
							<div class="trip-modern-list-row min-h-24 flex-col items-stretch">
								<strong class="capitalize">{budget.category}</strong>
								{#if budget.amount != null}
									<p class="trip-modern-panel-muted text-sm">{formatCents(budget.remaining ?? 0, budget.currency)} remaining</p>
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
				{/if}
				{#if data.expenses?.length}
					<ul class="mt-5 trip-modern-list" data-testid="expense-list">
						{#each data.expenses as e (e.id)}
							<li class="trip-modern-list-row">
								<div><strong>{e.description}</strong><p class="trip-modern-panel-muted text-sm capitalize">{e.category} · paid by {settlementName(e.paidBy)}</p>{#if e.attachments?.length}<div class="mt-1 flex flex-wrap gap-2">{#each e.attachments as a (a.id)}<a href="/trips/{trip.id}/expenses/{e.id}/attachments/{a.id}" target="_blank" class="link text-xs">{a.filename}</a>{/each}</div>{/if}</div>
								<div class="flex items-center gap-2"><span class="font-mono">{e.currency} {(e.amount / 100).toFixed(2)}</span>{#if isEditor}<form method="POST" action="?/deleteExpense"><input type="hidden" name="expenseId" value={e.id} /><button class="icon-button icon-button-sm" aria-label="Delete expense"><Icon name="close" class="h-3.5 w-3.5" /></button></form>{/if}</div>
							</li>
						{/each}
					</ul>
				{:else}<p class="trip-modern-empty mt-5">No expenses recorded yet.</p>{/if}
				{#if isEditor}
					<form method="POST" action="?/addExpense" class="trip-modern-form-grid mt-5 sm:grid-cols-2">
						<input name="description" class="input text-sm" placeholder="Description" required />
						<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" class="input text-sm" placeholder="Amount" required />
						<input name="currency" class="input text-sm" value="USD" placeholder="USD" required />
						<select name="category" class="input text-sm"><option value="lodging">Lodging</option><option value="transport">Transport</option><option value="food">Food</option><option value="activities">Activities</option><option value="other" selected>Other</option></select>
						<button class="btn btn-primary btn-sm sm:col-span-2">Add expense</button>
					</form>
					{#if data.expenses?.length}<form method="POST" action="?/addAttachment" enctype="multipart/form-data" class="trip-modern-form-inline"><input type="hidden" name="expenseId" value={data.expenses[0].id} /><input type="file" name="file" accept="image/*,application/pdf" class="input text-sm" required /><button class="btn btn-primary btn-sm">Upload</button></form>{/if}
				{/if}
			</section>
		{:else if activeTab === 'people'}
			<section class="trip-modern-panel">
				<div class="trip-modern-panel-head">
					<div><h2 class="trip-modern-panel-title">People</h2><p class="trip-modern-panel-muted text-sm">Travelers and trip support.</p></div>
					<span class="badge badge-slate badge-compact">{data.companions?.length ?? 0}</span>
				</div>
				{#if data.companions?.length}
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{#each data.companions as c (c.id)}
							<div class="trip-modern-list-row min-h-20">
								<div class="min-w-0"><strong class="block truncate">{c.name}</strong>{#if c.notes}<p class="trip-modern-panel-muted truncate text-sm">{c.notes}</p>{/if}</div>
								<span class="badge badge-slate badge-compact shrink-0 capitalize">{c.category}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="trip-modern-empty">No people yet.</p>
				{/if}
				{#if isEditor}
					<form method="POST" action="?/addCompanion" class="trip-modern-person-form" use:enhance>
						{#if data.owner === true}
							<div class="field"><Autocomplete name="selectedUserId" textName="name" id="companion-name" label="Name" value="" valueId={null} placeholder="Type a name or choose a user" required fetchSuggestions={fetchRoamarrUsers} onselect={(user) => (inviteEmail = user?.secondary ?? '')} /></div>
						{:else}
							<div class="field"><label class="label" for="companion-name">Name</label><input id="companion-name" name="name" class="input text-sm" placeholder="Name" required /></div>
						{/if}
						<div class="field">
							<label class="label" for="companion-category">Role</label>
							<select id="companion-category" name="category" class="input text-sm" value={travelerCategory} onchange={(event) => updateTravelerCategory(event.currentTarget.value)}>
								<option value="adult">Adult</option><option value="child">Child</option><option value="guide">Guide</option><option value="driver">Driver</option><option value="other">Other</option>
							</select>
						</div>
						{#if data.owner === true && travelerCategory !== 'guide' && travelerCategory !== 'driver'}
							<label class="checkbox-label self-end pb-2 sm:col-span-2"><input type="checkbox" name="invite" value="1" class="checkbox" bind:checked={inviteTraveler} /> Invite to Roamarr</label>
							{#if inviteTraveler}
								<div class="field"><label class="label" for="companion-email">Email address</label><input id="companion-email" name="email" type="email" class="input text-sm" placeholder="user@example.com" required bind:value={inviteEmail} /></div>
								<div class="field"><label class="label" for="companion-permission">Permission</label><select id="companion-permission" name="permission" class="input text-sm"><option value="read">Read only</option><option value="edit">Can edit</option></select></div>
							{/if}
						{/if}
						<div class="flex items-end justify-end sm:col-span-2"><button class="btn btn-primary btn-sm">Add person</button></div>
					</form>
				{/if}
			</section>
		{:else if activeTab === 'notes'}
			<section class="trip-modern-panel"><div class="trip-modern-panel-head"><h2 class="trip-modern-panel-title">Notes & activity</h2></div>{#if data.journalEntries?.length}<div class="trip-modern-list">{#each data.journalEntries as entry (entry.id)}<div class="trip-modern-list-row"><div><strong>{entry.title}</strong><p class="trip-modern-panel-muted text-sm">{entry.entryDate}</p><MarkdownText text={entry.body} class="mt-1 text-sm" /></div></div>{/each}</div>{/if}{#if data.comments?.length}<div class="mt-4 trip-modern-list">{#each data.comments as c (c.id)}<div class="trip-modern-list-row"><div><strong>{c.displayName}</strong><p class="trip-modern-panel-muted text-xs">{formatDateTime(c.createdAt)}</p><MarkdownText text={c.body} class="mt-1 text-sm" /></div></div>{/each}</div>{:else if !data.journalEntries?.length}<p class="trip-modern-empty">No notes yet.</p>{/if}{#if isEditor}<form method="POST" action="?/addJournalEntry" class="trip-modern-form-grid"><input name="title" class="input text-sm" placeholder="Title" required /><input name="entryDate" type="date" class="input text-sm" required /><textarea name="body" rows="3" class="input text-sm" placeholder="Write about your day..." required></textarea><p class="field-help">Markdown supported</p><button class="btn btn-primary btn-sm justify-self-end">Add journal entry</button></form><form method="POST" action="?/addComment" class="trip-modern-form-grid"><textarea name="body" rows="3" class="input text-sm" placeholder="Write a note…" required></textarea><p class="field-help">Markdown supported</p><button class="btn btn-primary btn-sm justify-self-end">Post note</button></form>{/if}</section>
		{:else if activeTab === 'documents'}
			<section class="trip-modern-panel">
				<div class="trip-modern-panel-head"><h2 class="trip-modern-panel-title">Files</h2><span class="badge badge-slate badge-compact">{data.tripDocuments?.length ?? 0}</span></div>
				<TripDocumentsTable
					tripId={trip.id}
					documents={data.tripDocuments ?? []}
					canEdit={isEditor}
					pageSize={5}
					showScope={true}
					segmentTitles={segmentTitleById}
					emptyMessage="No files uploaded yet. Attach PDFs or images (QR codes, vouchers, booking confirmations)."
				/>
				{#if isEditor}
					<form method="POST" action="?/uploadTripDocument" enctype="multipart/form-data" class="trip-modern-form-grid mt-4">
						<input name="label" class="input text-sm" placeholder="Label (optional)" />
						<select name="segmentId" class="input text-sm">
							<option value="">Whole trip</option>
							{#each segmentList as s (s.id)}
								{#if s.id != null}<option value={s.id}>{s.title}</option>{/if}
							{/each}
						</select>
						<input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf,.gpx,application/gpx+xml" class="input text-sm" required />
						<input name="notes" class="input text-sm" placeholder="Notes (optional)" />
						<button class="btn btn-primary btn-sm justify-self-end"><Icon name="upload" class="h-4 w-4" />Upload file</button>
					</form>
				{/if}
			</section>
			<section class="trip-modern-panel mt-4">
				<div class="trip-modern-panel-head"><h2 class="trip-modern-panel-title">Photos</h2><span class="badge badge-slate badge-compact">{data.gallery?.length ?? 0}</span></div>
				<Gallery
					images={galleryImages}
					canEdit={isEditor}
					uploadAction="?/uploadGalleryImages"
					removeAction="?/removeGalleryImage"
					moveAction="?/moveGalleryImage"
					captionAction="?/setGalleryCaption"
					emptyMessage="No photos yet. Upload trip photos below."
				/>
			</section>
			<section class="trip-modern-panel mt-4">
				<div class="trip-modern-panel-head"><h2 class="trip-modern-panel-title">External links</h2></div>
				{#if data.documentLinks?.length}
					<div class="trip-modern-list">
						{#each data.documentLinks as link (link.id)}
							<div class="trip-modern-list-row">
								<div>
									<a href={link.url} target="_blank" rel="noopener noreferrer" class="link">{link.label}</a>
									{#if link.notes}<p class="trip-modern-panel-muted text-sm">{link.notes}</p>{/if}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="trip-modern-empty">No external links yet.</p>
				{/if}
				{#if isEditor}
					<form method="POST" action="?/addDocumentLink" class="trip-modern-form-grid">
						<input name="label" class="input text-sm" placeholder="Label" required />
						<input name="url" type="url" class="input text-sm" placeholder="https://…" required />
						<input name="notes" class="input text-sm" placeholder="Notes (optional)" />
						<button class="btn btn-primary btn-sm justify-self-end">Add link</button>
					</form>
				{/if}
			</section>
		{/if}
	</div>

	<ConfirmModal open={deleteSegmentTarget !== null} title="Delete segment" message={`Delete ${deleteSegmentTarget?.title ?? 'this segment'}? This cannot be undone.`} confirmLabel="Delete" onconfirm={confirmDeleteSegment} oncancel={() => (deleteSegmentTarget = null)} />
</div>
