import { eq as kitEq, and as kitAnd, inList as kitInList, asc as kitAsc } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { tripPolls, tripPollOptions, tripPollVotes } from '$lib/server/db/mongrelSchema';
import type { Row, Insert, Update } from '@visorcraft/mongreldb-kit';

export type KitPoll = Row<typeof tripPolls>;
export type KitPollOption = Row<typeof tripPollOptions>;
export type KitPollVote = Row<typeof tripPollVotes>;

export interface PollVote {
	id: number;
	optionId: number;
	companionId: number;
}

export interface PollOption {
	id: number;
	label: string;
	sortOrder: number;
	voteCount: number;
}

export interface Poll {
	id: number;
	tripId: number;
	question: string;
	createdAt: string;
	options: PollOption[];
	votes: PollVote[];
}

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function idFromBigInt(id: bigint): number {
	return Number(id);
}

function toPoll(row: KitPoll): Poll {
	return {
		id: idFromBigInt(row.id),
		tripId: idFromBigInt(row.trip_id),
		question: row.question,
		createdAt: row.created_at,
		options: [],
		votes: []
	};
}

function toOption(row: KitPollOption): PollOption {
	return {
		id: idFromBigInt(row.id),
		label: row.label,
		sortOrder: Number(row.sort_order),
		voteCount: 0
	};
}

function toVote(row: KitPollVote): PollVote {
	return {
		id: idFromBigInt(row.id),
		optionId: idFromBigInt(row.option_id),
		companionId: idFromBigInt(row.companion_id)
	};
}










export function listPollsForTrip(tripId: number): Poll[] {
	const rows = kit
		.selectFrom(tripPolls)
		.where(kitEq(tripPolls.trip_id, toBigInt(tripId)))
		.orderBy(kitAsc(tripPolls.created_at))
		.executeSync();
	if (rows.length === 0) return [];

	const polls = rows.map(toPoll);
	const pollIds = polls.map((p) => p.id);

	const optionRows = kit
		.selectFrom(tripPollOptions)
		.where(kitInList(tripPollOptions.poll_id, pollIds.map(toBigInt)))
		.orderBy(kitAsc(tripPollOptions.sort_order))
		.executeSync();
	const options = optionRows.map(toOption);

	const optionIds = options.map((o) => o.id);
	const voteRows = optionIds.length
		? kit
				.selectFrom(tripPollVotes)
				.where(kitInList(tripPollVotes.option_id, optionIds.map(toBigInt)))
				.executeSync()
		: [];
	const votes = voteRows.map(toVote);

	const optionsByPoll = new Map<number, PollOption[]>();
	for (const option of options) {
		const list = optionsByPoll.get(option.id) ?? [];
		optionsByPoll.set(option.id, list);
	}
	const votesByPoll = new Map<number, PollVote[]>();
	const voteCountByOption = new Map<number, number>();
	for (const vote of votes) {
		const list = votesByPoll.get(vote.optionId) ?? [];
		list.push(vote);
		votesByPoll.set(vote.optionId, list);
		voteCountByOption.set(vote.optionId, (voteCountByOption.get(vote.optionId) ?? 0) + 1);
	}

	const optionsByPollId = new Map<number, PollOption[]>();
	for (const option of options) {
		// Find the poll this option belongs to.  Since options were loaded by
		// option_id only, we need the poll_id from the raw row.
		const raw = optionRows.find((r) => idFromBigInt(r.id) === option.id)!;
		const pollId = idFromBigInt(raw.poll_id);
		const list = optionsByPollId.get(pollId) ?? [];
		list.push({ ...option, voteCount: voteCountByOption.get(option.id) ?? 0 });
		optionsByPollId.set(pollId, list);
	}

	for (const poll of polls) {
		poll.options = optionsByPollId.get(poll.id) ?? [];
		poll.votes = votes.filter((v) => poll.options.some((o) => o.id === v.optionId));
	}

	return polls;
}

export function getPollById(pollId: number): Poll | null {
	const rows = kit.selectFrom(tripPolls).where(kitEq(tripPolls.id, toBigInt(pollId))).executeSync();
	if (!rows[0]) return null;
	const polls = listPollsForTrip(idFromBigInt(rows[0].trip_id));
	return polls.find((p) => p.id === pollId) ?? null;
}

export function createPoll(tripId: number, question: string, options: string[]): Poll {
	const row = kit
		.insertInto(tripPolls)
		.values({
			trip_id: toBigInt(tripId),
			question
		} as Insert<typeof tripPolls>)
		.executeSync();
	const pollId = idFromBigInt(row.id);

	for (let i = 0; i < options.length; i++) {
		const optionRow = kit
			.insertInto(tripPollOptions)
			.values({
				poll_id: toBigInt(pollId),
				label: options[i]!,
				sort_order: BigInt(i)
			} as Insert<typeof tripPollOptions>)
			.executeSync();
	}

	return getPollById(pollId)!;
}

export function deletePoll(pollId: number): number {
	const deleted = kit.deleteFrom(tripPolls).where(kitEq(tripPolls.id, toBigInt(pollId))).executeSync();
	return Number(deleted);
}

export function getOptionById(optionId: number) {
	const rows = kit
		.selectFrom(tripPollOptions)
		.where(kitEq(tripPollOptions.id, toBigInt(optionId)))
		.executeSync();
	if (!rows[0]) return null;
	return {
		id: idFromBigInt(rows[0].id),
		pollId: idFromBigInt(rows[0].poll_id),
		label: rows[0].label,
		sortOrder: Number(rows[0].sort_order),
		createdAt: rows[0].created_at
	};
}

export function castVote(pollId: number, optionId: number, companionId: number): PollVote {
	const option = getOptionById(optionId);
	if (!option || option.pollId !== pollId) {
		throw new Error('Option not found');
	}

	// Enforce one vote per companion per poll.
	const existing = kit
		.selectFrom(tripPollVotes)
		.where(
			kitAnd(
				kitEq(tripPollVotes.poll_id, toBigInt(pollId)),
				kitEq(tripPollVotes.companion_id, toBigInt(companionId))
			)
		)
		.executeSync()[0];
	if (existing) {
		kit
			.deleteFrom(tripPollVotes)
			.where(kitEq(tripPollVotes.id, existing.id))
			.executeSync();
			}

	const row = kit
		.insertInto(tripPollVotes)
		.values({
			poll_id: toBigInt(pollId),
			option_id: toBigInt(optionId),
			companion_id: toBigInt(companionId)
		} as Insert<typeof tripPollVotes>)
		.executeSync();
	return toVote(row);
}

export function removeVote(pollId: number, companionId: number): number {
	const existing = kit
		.selectFrom(tripPollVotes)
		.where(
			kitAnd(
				kitEq(tripPollVotes.poll_id, toBigInt(pollId)),
				kitEq(tripPollVotes.companion_id, toBigInt(companionId))
			)
		)
		.executeSync()[0];
	if (!existing) return 0;

	const deleted = kit
		.deleteFrom(tripPollVotes)
		.where(kitEq(tripPollVotes.id, existing.id))
		.executeSync();
		return Number(deleted);
}
