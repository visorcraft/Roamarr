import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

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
} from '$lib/server/db/schema';
import {
	users as kitUsers,
	trips as kitTrips,
	tripCompanions as kitTripCompanions,
	tripPolls as kitTripPolls,
	tripPollOptions as kitTripPollOptions,
	tripPollVotes as kitTripPollVotes
} from '$lib/server/db/mongrelSchema';
import { eq } from 'drizzle-orm';

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
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	const row = db
		.insert(tripCompanions)
		.values({ tripId, name, category: 'adult' })
		.returning()
		.get();
	kit.insertInto(kitTripCompanions).values({
		id: BigInt(row.id),
		trip_id: BigInt(tripId),
		name: row.name,
		category: row.category
	} as never).executeSync();
	return row;
}

beforeEach(() => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	db.delete(tripPollVotes).run();
	db.delete(tripPollOptions).run();
	db.delete(tripPolls).run();
	db.delete(tripCompanions).run();
	db.delete(trips).run();
	db.delete(users).run();
	kit.deleteFrom(kitTripPollVotes).executeSync();
	kit.deleteFrom(kitTripPollOptions).executeSync();
	kit.deleteFrom(kitTripPolls).executeSync();
	kit.deleteFrom(kitTripCompanions).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
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

	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	expect(db.select().from(tripPolls).where(eq(tripPolls.id, poll.id)).get()).toBeUndefined();
	expect(db.select().from(tripPollOptions).where(eq(tripPollOptions.pollId, poll.id)).all()).toHaveLength(0);
	expect(db.select().from(tripPollVotes).where(eq(tripPollVotes.pollId, poll.id)).all()).toHaveLength(0);
});

test('legacy tables stay in sync with kit writes', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser('pr8@x.c');
	const t = makeTrip(Number(u.id), 'T');

	const poll = pollsRepo.createPoll(t.id, 'Legacy?', ['Yes', 'No']);

	const legacyPoll = db.select().from(tripPolls).where(eq(tripPolls.id, poll.id)).get();
	expect(legacyPoll?.question).toBe('Legacy?');
	const legacyOptions = db.select().from(tripPollOptions).where(eq(tripPollOptions.pollId, poll.id)).all();
	expect(legacyOptions).toHaveLength(2);
});
