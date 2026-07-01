import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import * as pollsRepo from './pollsRepo';
import * as usersRepo from './usersRepo';
import * as tripsRepo from './tripsRepo';
import {
	users,
	trips,
	tripCompanions,
	tripPolls,
	tripPollOptions,
	tripPollVotes
} from '$lib/server/db/mongrelSchema';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeUser(email: string) {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: email,
		calendar_token: null,
		calendar_token_expires_at: null
	});
}

function makeTrip(ownerId: number, name: string) {
	return tripsRepo.createTrip(ownerId, { name });
}

function makeCompanion(tripId: number, name: string) {
	const row = kitDb()
		.insertInto(tripCompanions)
		.values({ trip_id: BigInt(tripId), name, category: 'adult' } as never)
		.executeSync();
	return { id: Number(row.id), name: row.name as string };
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(tripPollVotes).executeSync();
	kit.deleteFrom(tripPollOptions).executeSync();
	kit.deleteFrom(tripPolls).executeSync();
	kit.deleteFrom(tripCompanions).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('createPoll stores a poll with ordered options', () => {
	const u = makeUser('pr1@x.c');
	const t = makeTrip(Number(u.id), 'T');

	const poll = pollsRepo.createPoll(t.id, 'Dinner?', ['Pizza', 'Sushi']);

	expect(poll.tripId).toBe(t.id);
	expect(poll.question).toBe('Dinner?');
	expect(poll.options.map((o) => o.label)).toEqual(['Pizza', 'Sushi']);
	expect(poll.options[0].sortOrder).toBe(0);
	expect(poll.options[1].sortOrder).toBe(1);
});

test('listPollsForTrip returns polls scoped to the trip', () => {
	const u = makeUser('pr2@x.c');
	const t1 = makeTrip(Number(u.id), 'T1');
	const t2 = makeTrip(Number(u.id), 'T2');

	pollsRepo.createPoll(t1.id, 'Q1?', ['A', 'B']);
	pollsRepo.createPoll(t2.id, 'Q2?', ['C', 'D']);

	expect(pollsRepo.listPollsForTrip(t1.id)).toHaveLength(1);
	expect(pollsRepo.listPollsForTrip(t1.id)[0].question).toBe('Q1?');
});

test('getPollById returns null for missing poll', () => {
	expect(pollsRepo.getPollById(9999)).toBeNull();
});

test('castVote creates a vote and counts it', () => {
	const u = makeUser('pr3@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const c = makeCompanion(t.id, 'Alex');
	const poll = pollsRepo.createPoll(t.id, 'Activity?', ['Hike', 'Beach']);
	const option = poll.options[0];

	pollsRepo.castVote(poll.id, option.id, c.id);

	const refreshed = pollsRepo.getPollById(poll.id)!;
	expect(refreshed.options[0].voteCount).toBe(1);
	expect(refreshed.votes).toHaveLength(1);
	expect(refreshed.votes[0].optionId).toBe(option.id);
});

test('castVote enforces one vote per companion by replacing the previous vote', () => {
	const u = makeUser('pr4@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const c = makeCompanion(t.id, 'Blake');
	const poll = pollsRepo.createPoll(t.id, 'X?', ['A', 'B']);
	const optionA = poll.options[0];
	const optionB = poll.options[1];

	pollsRepo.castVote(poll.id, optionA.id, c.id);
	pollsRepo.castVote(poll.id, optionB.id, c.id);

	const refreshed = pollsRepo.getPollById(poll.id)!;
	expect(refreshed.options[0].voteCount).toBe(0);
	expect(refreshed.options[1].voteCount).toBe(1);
	expect(refreshed.votes).toHaveLength(1);
});

test('castVote throws when option belongs to a different poll', () => {
	const u = makeUser('pr5@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const c = makeCompanion(t.id, 'Casey');
	const pollA = pollsRepo.createPoll(t.id, 'A?', ['1', '2']);
	const pollB = pollsRepo.createPoll(t.id, 'B?', ['3', '4']);

	expect(() => pollsRepo.castVote(pollA.id, pollB.options[0].id, c.id)).toThrow();
});

test('removeVote deletes a companion vote', () => {
	const u = makeUser('pr6@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const c = makeCompanion(t.id, 'Drew');
	const poll = pollsRepo.createPoll(t.id, 'Y?', ['A', 'B']);

	pollsRepo.castVote(poll.id, poll.options[0].id, c.id);
	expect(pollsRepo.removeVote(poll.id, c.id)).toBe(1);

	const refreshed = pollsRepo.getPollById(poll.id)!;
	expect(refreshed.votes).toHaveLength(0);
	expect(refreshed.options[0].voteCount).toBe(0);
});

test('deletePoll removes poll, options, and votes', () => {
	const u = makeUser('pr7@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const c = makeCompanion(t.id, 'Eden');
	const poll = pollsRepo.createPoll(t.id, 'Z?', ['A', 'B']);
	pollsRepo.castVote(poll.id, poll.options[0].id, c.id);

	expect(pollsRepo.deletePoll(poll.id)).toBe(1);

	const kit = kitDb();
	expect(kit.selectFrom(tripPolls).where(eq(tripPolls.id, BigInt(poll.id))).executeSync()[0]).toBeUndefined();
	expect(kit.selectFrom(tripPollOptions).where(eq(tripPollOptions.poll_id, BigInt(poll.id))).executeSync()).toHaveLength(0);
	expect(kit.selectFrom(tripPollVotes).where(eq(tripPollVotes.poll_id, BigInt(poll.id))).executeSync()).toHaveLength(0);
});

test('poll writes are persisted', () => {
	const kit = kitDb();
	const u = makeUser('pr8@x.c');
	const t = makeTrip(Number(u.id), 'T');

	const poll = pollsRepo.createPoll(t.id, 'Stored?', ['Yes', 'No']);

	const storedPoll = kit.selectFrom(tripPolls).where(eq(tripPolls.id, BigInt(poll.id))).executeSync()[0];
	expect(storedPoll?.question).toBe('Stored?');
	const storedOptions = kit.selectFrom(tripPollOptions).where(eq(tripPollOptions.poll_id, BigInt(poll.id))).executeSync();
	expect(storedOptions).toHaveLength(2);
});
