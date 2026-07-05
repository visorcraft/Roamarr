import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { withTripAction } from './actions';
import * as pollsRepo from './repositories/pollsRepo';
import { logAudit } from './audit';
import { requireEditableTrip, requireCompanionOnTrip } from './ownership';
import { Validator } from './validation';
import { bumpTripUpdatedAt } from './tz';

export type { Poll } from './repositories/pollsRepo';

export function listPollsWithVotes(tripId: number): pollsRepo.Poll[] {
	return pollsRepo.listPollsForTrip(tripId);
}

export function createTripPoll(
	userId: number,
	tripId: number,
	question: string,
	options: string[]
): pollsRepo.Poll {
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

	const poll = pollsRepo.createPoll(tripId, q, labels);

	bumpTripUpdatedAt(tripId);
	logAudit(userId, 'create', 'trip_poll', poll.id, { tripId, question: q });

	return poll;
}

function requirePoll(pollId: number) {
	const poll = pollsRepo.getPollById(pollId);
	if (!poll) throw error(404, 'Poll not found');
	return poll;
}

function validateVote(pollId: number, companionId: number, optionId: number) {
	const poll = requirePoll(pollId);

	const option = pollsRepo.getOptionById(optionId);
	if (!option || option.pollId !== pollId) throw error(404, 'Option not found');

	requireCompanionOnTrip(companionId, poll.tripId);

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

	pollsRepo.castVote(pollId, optionId, companionId);

	bumpTripUpdatedAt(poll.tripId);
	logAudit(userId, 'vote', 'trip_poll', pollId, { tripId: poll.tripId, optionId, companionId });
}

export function removeTripPoll(userId: number, pollId: number) {
	const poll = requirePoll(pollId);
	requireEditableTrip(userId, poll.tripId);

	pollsRepo.deletePoll(pollId);

	bumpTripUpdatedAt(poll.tripId);
	logAudit(userId, 'delete', 'trip_poll', pollId, { tripId: poll.tripId });
}

export async function createPoll(event: RequestEvent) {
	const { user: u, tripId, formData: f } = await withTripAction(event);
	const v = new Validator();
	const question = v.requiredString(f.get('question'), 'question', { max: 500 });

	const rawOptions = f
		.getAll('options')
		.map((o) => String(o ?? '').trim())
		.filter(Boolean);
	if (rawOptions.length < 2) v.addError('options', 'Provide at least 2 options');
	if (rawOptions.length > 10) v.addError('options', 'At most 10 options allowed');
	for (let i = 0; i < rawOptions.length; i++) {
		if (rawOptions[i]!.length > 200) {
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
	const { user: u, tripId, formData: f } = await withTripAction(event);
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
	const { user: u, tripId, formData: f } = await withTripAction(event);
	const pollId = Number(f.get('pollId'));
	if (!Number.isFinite(pollId) || pollId <= 0) throw error(400, 'Invalid poll');

	removeTripPoll(u.id, pollId);
	throw redirect(303, `/trips/${tripId}`);
}
