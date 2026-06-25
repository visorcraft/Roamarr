import { error, redirect, type Actions } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { cards, fareProviders, fareWatches, segments, trips } from '$lib/server/db/schema';
import {
	attachPolicyToTrip,
	detachPolicyFromTrip,
	listPoliciesForUser
} from '$lib/server/insurance';
import { addComment, deleteComment, listComments } from '$lib/server/tripComments';
import { duplicateSegment, setSegmentStatus } from '$lib/server/segments';
import {
	duplicateTrip,
	loadTripFor,
	regenerateCalendarToken,
	revokeCalendarToken,
	type TripView
} from '../shared';
import { requireOwnedTrip, requireEditableTrip } from '$lib/server/ownership';
import { upsertCustomReminder } from '$lib/server/reminders';
import {
	addCompanion,
	updateCompanion,
	deleteCompanion,
	listTripCompanions
} from '$lib/server/tripCompanions';
import {
	addChecklistItem,
	toggleChecklistItem,
	deleteChecklistItem,
	loadChecklist
} from '$lib/server/tripChecklists';
import { listTemplates, saveChecklistTemplate, applyChecklistTemplate } from '$lib/server/packingTemplates';
import {
	addExpense,
	deleteExpense,
	listTripExpenses,
	summarizeTripExpenses,
	computeSettlement
} from '$lib/server/tripExpenses';
import {
	setAttendeeStatus,
	removeAttendee,
	listAttendeesForSegments
} from '$lib/server/segmentAttendees';
import {
	addJournalEntry,
	updateJournalEntry,
	deleteJournalEntry,
	listJournalEntries
} from '$lib/server/tripJournal';
import {
	addDocumentLink,
	updateDocumentLink,
	deleteDocumentLink,
	listDocumentLinks
} from '$lib/server/tripDocumentLinks';
import { createPoll, deletePoll, listPollsWithVotes, votePoll } from '$lib/server/tripPolls';
import { listBudgetsWithSpent, setBudgetAction, deleteBudgetAction } from '$lib/server/tripBudgets';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
	const u = requireUser(locals);
	const view = loadTripFor(u.id, Number(params.id));
	const companions = listTripCompanions(view.trip.id).map((c) =>
		view.editor
			? c
			: { ...c, notes: null, dietary: null, allergies: null, medicalNotes: null }
	);
	const checklist = loadChecklist(view.trip.id);
	const expenses = listTripExpenses(view.trip.id);
	const expenseSummary = summarizeTripExpenses(expenses, companions);
	const expenseSettlement = computeSettlement(expenses, companions);
	const budgets = listBudgetsWithSpent(view.trip.id, expenses);
	const journalEntries = listJournalEntries(view.trip.id);
	const documentLinks = listDocumentLinks(view.trip.id);
	const polls = listPollsWithVotes(view.trip.id);
	let attendeesBySegment = new Map<number, ReturnType<typeof listAttendeesForSegments> extends Map<number, infer V> ? V : never>();
	if (view.editor) {
		const segmentIds = view.segments.map((s) => s.id).filter((id): id is number => !!id);
		attendeesBySegment = listAttendeesForSegments(segmentIds);
	}
	if (view.owner) {
		const providers = db
			.select({
				id: fareProviders.id,
				providerKey: fareProviders.providerKey,
				label: fareProviders.label
			})
			.from(fareProviders)
			.where(and(eq(fareProviders.userId, u.id), eq(fareProviders.enabled, true)))
			.all();
		const watches = db
			.select({
				id: fareWatches.id,
				status: fareWatches.status,
				segmentId: fareWatches.segmentId,
				segmentTitle: segments.title,
				providerKey: fareProviders.providerKey,
				label: fareProviders.label,
				lastCheckedAt: fareWatches.lastCheckedAt,
				lastResultJson: fareWatches.lastResultJson
			})
			.from(fareWatches)
			.innerJoin(fareProviders, eq(fareWatches.providerId, fareProviders.id))
			.leftJoin(segments, eq(fareWatches.segmentId, segments.id))
			.where(eq(fareWatches.tripId, view.trip.id))
			.all();
		const feedUrl = view.trip.calendarToken
			? `${url.origin}/trips/${view.trip.id}/calendar/feed?token=${encodeURIComponent(view.trip.calendarToken)}`
			: null;
		const publicShareUrl = view.trip.publicToken
			? `${url.origin}/share/${encodeURIComponent(view.trip.publicToken)}`
			: null;
		const userCards = db
			.select({ id: cards.id, nickname: cards.nickname, network: cards.network, last4: cards.last4 })
			.from(cards)
			.where(eq(cards.userId, u.id))
			.all();
		const allPolicies = listPoliciesForUser(u.id);
		const policies = allPolicies.filter((p) => p.tripId === view.trip.id);
		const availablePolicies = allPolicies.filter((p) => p.tripId !== view.trip.id);
		const comments = listComments(view.trip.id);
		const templates = listTemplates(u.id);
		return { ...view, companions, checklist, expenses, expenseSummary, expenseSettlement, budgets, journalEntries, documentLinks, polls, attendeesBySegment, providers, watches, cards: userCards, policies, availablePolicies, feedUrl, publicShareUrl, comments, templates };
	}
	return { ...view, companions, checklist, expenses, expenseSummary, expenseSettlement, budgets, journalEntries, documentLinks, polls, attendeesBySegment, comments: listComments(view.trip.id) };
};

export const actions: Actions = {
	regenerateCalendarFeed: async ({ locals, params, request }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const f = await request.formData();
		const expiresAt = String(f.get('calendarExpiresAt') || '');
		regenerateCalendarToken(u.id, tripId, expiresAt || null);
		throw redirect(303, `/trips/${tripId}`);
	},
	revokeCalendarFeed: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		revokeCalendarToken(u.id, tripId);
		throw redirect(303, `/trips/${tripId}`);
	},
	duplicate: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const copy = duplicateTrip(u.id, tripId);
		throw redirect(303, `/trips/${copy.id}`);
	},
	toggleArchive: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const t = requireOwnedTrip(u.id, tripId);
		db.update(trips).set({ archived: !t.archived }).where(eq(trips.id, tripId)).run();
		throw redirect(303, `/trips/${tripId}`);
	},
	toggleFavorite: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const t = requireOwnedTrip(u.id, tripId);
		db.update(trips).set({ favorite: !t.favorite }).where(eq(trips.id, tripId)).run();
		throw redirect(303, `/trips/${tripId}`);
	},
	customReminder: async ({ locals, params, request }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const t = requireOwnedTrip(u.id, tripId);
		const f = await request.formData();
		const offset = Number(f.get('offsetMinutes') ?? 60);
		if (!Number.isFinite(offset) || offset < 0) throw error(400, 'Invalid offset');
		if (!t.startDate) throw error(400, 'Trip has no start date');
		const startAt = `${t.startDate}T09:00:00Z`;
		upsertCustomReminder(u.id, 'trip', tripId, startAt, offset);
		throw redirect(303, `/trips/${tripId}`);
	},
	segmentReminder: async ({ locals, params, request }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		requireEditableTrip(u.id, tripId);
		const f = await request.formData();
		const segmentId = Number(f.get('segmentId'));
		const offset = Number(f.get('offsetMinutes') ?? 60);
		if (!Number.isFinite(segmentId) || segmentId <= 0) throw error(400, 'Invalid segment');
		if (!Number.isFinite(offset) || offset < 0) throw error(400, 'Invalid offset');
		const seg = db
			.select()
			.from(segments)
			.where(and(eq(segments.id, segmentId), eq(segments.tripId, tripId)))
			.get();
		if (!seg) throw error(404, 'Segment not found');
		upsertCustomReminder(u.id, 'segment', segmentId, seg.startAt, offset);
		throw redirect(303, `/trips/${tripId}`);
	},
	duplicateSegment: async ({ locals, params, request }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const segmentId = Number((await request.formData()).get('segmentId'));
		if (!Number.isFinite(segmentId) || segmentId <= 0) throw error(400, 'Invalid segment');
		duplicateSegment(u.id, tripId, segmentId);
		throw redirect(303, `/trips/${tripId}`);
	},
	setSegmentStatus: async ({ locals, params, request }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const f = await request.formData();
		const segmentId = Number(f.get('segmentId'));
		const status = String(f.get('status') || '');
		if (!Number.isFinite(segmentId) || segmentId <= 0) throw error(400, 'Invalid segment');
		if (!status) throw error(400, 'Invalid status');
		setSegmentStatus(u.id, tripId, segmentId, status as import('$lib/server/db/schema').SegmentStatus);
		throw redirect(303, `/trips/${tripId}`);
	},
	attachPolicy: async ({ locals, params, request }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		requireOwnedTrip(u.id, tripId);
		const policyId = Number((await request.formData()).get('policyId'));
		if (!Number.isFinite(policyId) || policyId <= 0) throw error(400, 'Invalid policy');
		attachPolicyToTrip(u.id, policyId, tripId);
		throw redirect(303, `/trips/${tripId}`);
	},
	detachPolicy: async ({ locals, params, request }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		requireOwnedTrip(u.id, tripId);
		const policyId = Number((await request.formData()).get('policyId'));
		if (!Number.isFinite(policyId) || policyId <= 0) throw error(400, 'Invalid policy');
		detachPolicyFromTrip(u.id, policyId);
		throw redirect(303, `/trips/${tripId}`);
	},
	addComment: async ({ locals, params, request }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		requireEditableTrip(u.id, tripId);
		const body = String((await request.formData()).get('body') || '');
		if (!body.trim()) throw error(400, 'Comment is required');
		addComment(u.id, tripId, body);
		throw redirect(303, `/trips/${tripId}`);
	},
	deleteComment: async ({ locals, params, request }) => {
		const u = requireUser(locals);
		const tripId = Number(params.id);
		if (!Number.isFinite(tripId)) throw error(404, 'Not found');
		const commentId = Number((await request.formData()).get('commentId'));
		if (!Number.isFinite(commentId) || commentId <= 0) throw error(400, 'Invalid comment');
		deleteComment(u.id, commentId);
		throw redirect(303, `/trips/${tripId}`);
	},
	addCompanion,
	updateCompanion,
	deleteCompanion,
	addChecklistItem,
	toggleChecklistItem,
	deleteChecklistItem,
	addExpense,
	deleteExpense,
	setAttendeeStatus,
	removeAttendee,
	addJournalEntry,
	updateJournalEntry,
	deleteJournalEntry,
	addDocumentLink,
	updateDocumentLink,
	deleteDocumentLink,
	createPoll,
	votePoll,
	deletePoll,
	saveChecklistTemplate,
	applyChecklistTemplate,
	setBudget: setBudgetAction,
	deleteBudget: deleteBudgetAction
};
