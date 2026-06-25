import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { requireUser } from './auth';
import { db } from './db';
import {
	tripPolls,
	tripPollOptions,
	tripPollVotes,
	tripCompanions,
	trips
} from './db/schema';
import { logAudit } from './audit';
import { requireEditableTrip } from './ownership';
import { Validator } from './validation';

export interface PollVoteView {
	id: number;
	optionId: number;
	companionId: number;
}

export interface PollOptionView {
	id: number;
	label: string;
	sortOrder: number;
	voteCount: number;
}

export interface PollWithVotes {
	id: number;
	tripId: number;
	question: string;
	createdAt: string;
	options: PollOptionView[];
	votes: PollVoteView[];
}

function utcNow() {
	return DateTime.utc().toISO()!;
}

function bumpTripUpdatedAt(tripId: number) {
	db.update(trips).set({ updatedAt: utcNow() }).where(eq(trips.id, tripId)).run();
}

export function listPollsWithVotes(tripId: number): PollWithVotes[] {
	const polls = db
		.select()
		.from(tripPolls)
		.where(eq(tripPolls.tripId, tripId))
		.orderBy(tripPolls.createdAt)
		.all();

	const pollIds = polls.map((p) => p.id);
	const options = pollIds.length
		? db
				.select()
				.from(tripPollOptions)
				.where(inArray(tripPollOptions.pollId, pollIds))
				.orderBy(tripPollOptions.sortOrder)
				.all()
		: [];

	const optionIds = options.map((o) => o.id);
	const votes = optionIds.length
		? db
				.select()
				.from(tripPollVotes)
				.where(inArray(tripPollVotes.optionId, optionIds))
				.all()
		: [];

	const countByOption = new Map<number, number>();
	for (const v of votes) {
		countByOption.set(v.optionId, (countByOption.get(v.optionId) ?? 0) + 1);
	}

	return polls.map((p) => ({
		...p,
		options: options
			.filter((o) => o.pollId === p.id)
			.map((o) => ({
				id: o.id,
				label: o.label,
				sortOrder: o.sortOrder,
				voteCount: countByOption.get(o.id) ?? 0
			})),
		votes: votes
			.filter((v) => v.pollId === p.id)
			.map((v) => ({ id: v.id, optionId: v.optionId, companionId: v.companionId }))
	}));
}

export function createTripPoll(
	userId: number,
	tripId: number,
	question: string,
	options: string[]
): PollWithVotes {
	requireEditableTrip(userId, tripId);

	const q = question.trim();
	if (!q) throw error(400, 'Question is required');
	if (q.length > 500) throw error(400, 'Question must be at most 500 characters');

	const labels = options.map((o) => o.trim()).filter(Boolean);
	if (labels.length < 2) throw error(400, 'Provide at least 2 options');
	if (labels.length > 10) throw error(400, 'At most 10 options allowed');
	for (const label of labels) {
		if (label.length > 200) throw error(400, 'Each option must be at most 200 characters');
	}

	const poll = db
		.insert(tripPolls)
		.values({ tripId, question: q })
		.returning()
		.get();

	for (let i = 0; i < labels.length; i++) {
		db.insert(tripPollOptions)
			.values({ pollId: poll.id, label: labels[i], sortOrder: i })
			.run();
	}

	bumpTripUpdatedAt(tripId);
	logAudit(userId, 'create', 'trip_poll', poll.id, { tripId, question: q });

	return listPollsWithVotes(tripId).find((p) => p.id === poll.id)!;
}

function requirePoll(pollId: number) {
	const poll = db.select().from(tripPolls).where(eq(tripPolls.id, pollId)).get();
	if (!poll) throw error(404, 'Poll not found');
	return poll;
}

function validateVote(pollId: number, companionId: number, optionId: number) {
	const poll = requirePoll(pollId);

	const option = db
		.select()
		.from(tripPollOptions)
		.where(and(eq(tripPollOptions.id, optionId), eq(tripPollOptions.pollId, pollId)))
		.get();
	if (!option) throw error(404, 'Option not found');

	const companion = db
		.select()
		.from(tripCompanions)
		.where(and(eq(tripCompanions.id, companionId), eq(tripCompanions.tripId, poll.tripId)))
		.get();
	if (!companion) throw error(404, 'Companion not found');

	return poll;
}

export function castVote(
	userId: number,
	pollId: number,
	companionId: number,
	optionId: number
) {
	const poll = validateVote(pollId, companionId, optionId);
	requireEditableTrip(userId, poll.tripId);

	db.insert(tripPollVotes)
		.values({ pollId, optionId, companionId })
		.onConflictDoUpdate({
			target: [tripPollVotes.pollId, tripPollVotes.companionId],
			set: { optionId }
		})
		.run();

	bumpTripUpdatedAt(poll.tripId);
	logAudit(userId, 'vote', 'trip_poll', pollId, { tripId: poll.tripId, optionId, companionId });
}

export function removeTripPoll(userId: number, pollId: number) {
	const poll = requirePoll(pollId);
	requireEditableTrip(userId, poll.tripId);

	db.delete(tripPolls).where(eq(tripPolls.id, pollId)).run();

	bumpTripUpdatedAt(poll.tripId);
	logAudit(userId, 'delete', 'trip_poll', pollId, { tripId: poll.tripId });
}

export async function createPoll(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');

	const f = await event.request.formData();
	const v = new Validator();
	const question = v.requiredString(f.get('question'), 'question', { max: 500 });

	const rawOptions = f
		.getAll('options')
		.map((o) => String(o ?? '').trim())
		.filter(Boolean);
	if (rawOptions.length < 2) v.addError('options', 'Provide at least 2 options');
	if (rawOptions.length > 10) v.addError('options', 'At most 10 options allowed');
	for (let i = 0; i < rawOptions.length; i++) {
		if (rawOptions[i].length > 200) {
			v.addError('options', `Option ${i + 1} must be at most 200 characters`);
		}
	}

	if (!v.ok()) {
		return fail(400, { error: v.failMessage(), errors: v.errors });
	}

	createTripPoll(u.id, tripId, question!, rawOptions);
	throw redirect(303, `/trips/${tripId}`);
}

export async function votePoll(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');

	const f = await event.request.formData();
	const pollId = Number(f.get('pollId'));
	const companionId = Number(f.get('companionId'));
	const optionId = Number(f.get('optionId'));

	if (!Number.isFinite(pollId) || pollId <= 0) throw error(400, 'Invalid poll');
	if (!Number.isFinite(companionId) || companionId <= 0) throw error(400, 'Invalid companion');
	if (!Number.isFinite(optionId) || optionId <= 0) throw error(400, 'Invalid option');

	castVote(u.id, pollId, companionId, optionId);
	throw redirect(303, `/trips/${tripId}`);
}

export async function deletePoll(event: RequestEvent) {
	const u = requireUser(event.locals);
	const tripId = Number(event.params.id);
	if (!Number.isFinite(tripId)) throw error(404, 'Not found');

	const f = await event.request.formData();
	const pollId = Number(f.get('pollId'));
	if (!Number.isFinite(pollId) || pollId <= 0) throw error(400, 'Invalid poll');

	removeTripPoll(u.id, pollId);
	throw redirect(303, `/trips/${tripId}`);
}
