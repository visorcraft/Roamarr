import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	listPollsWithVotes,
	createTripPoll,
	castVote,
	removeTripPoll,
	createPoll,
	votePoll,
	deletePoll
} from './tripPolls';
import {
	users,
	trips,
	tripCompanions,
	tripPolls,
	tripPollOptions,
	tripPollVotes,
	auditLogs
} from './db/schema';
import { users as kitUsers, trips as kitTrips, tripCompanions as kitTripCompanions } from './db/mongrelSchema';
import { eq, and } from 'drizzle-orm';
import { makeActionEvent } from '../../../tests/eventHelpers';
import * as usersRepo from './repositories/usersRepo';
import * as tripsRepo from './repositories/tripsRepo';

const event = makeActionEvent;

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
	const db = (ctx as { db: import('./db').DB }).db;
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
	const db = (ctx as { db: import('./db').DB }).db;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	db.delete(tripPollVotes).run();
	db.delete(tripPollOptions).run();
	db.delete(tripPolls).run();
	db.delete(tripCompanions).run();
	db.delete(trips).run();
	db.delete(auditLogs).run();
	db.delete(users).run();
	kit.deleteFrom(kitTripCompanions).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
});

test('create and list polls with options and vote counts', () => {
	const u = makeUser('p@x.c');
	const t = makeTrip(Number(u.id), 'T');

	const poll = createTripPoll(Number(u.id), t.id, 'Where should we eat?', ['Italian', 'Sushi', 'Burgers']);

	const polls = listPollsWithVotes(t.id);
	expect(polls).toHaveLength(1);
	expect(polls[0].id).toBe(poll.id);
	expect(polls[0].question).toBe('Where should we eat?');
	expect(polls[0].options.map((o) => o.label)).toEqual(['Italian', 'Sushi', 'Burgers']);
	expect(polls[0].options.every((o) => o.voteCount === 0)).toBe(true);
});

test('vote records a vote and updates counts', () => {
	const u = makeUser('v@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const c = makeCompanion(t.id, 'Alice');
	const poll = createTripPoll(Number(u.id), t.id, 'Dinner?', ['A', 'B']);
	const optionA = poll.options.find((o) => o.label === 'A')!;

	castVote(Number(u.id), poll.id, c.id, optionA.id);

	const polls = listPollsWithVotes(t.id);
	const refreshed = polls.find((p) => p.id === poll.id)!;
	expect(refreshed.options.find((o) => o.id === optionA.id)!.voteCount).toBe(1);
	expect(refreshed.votes).toContainEqual({ id: expect.any(Number), optionId: optionA.id, companionId: c.id });
});

test('changing vote replaces previous vote and keeps one per companion', () => {
	const u = makeUser('cv@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const c = makeCompanion(t.id, 'Bob');
	const poll = createTripPoll(Number(u.id), t.id, 'Plan?', ['X', 'Y']);
	const optionX = poll.options.find((o) => o.label === 'X')!;
	const optionY = poll.options.find((o) => o.label === 'Y')!;

	castVote(Number(u.id), poll.id, c.id, optionX.id);
	castVote(Number(u.id), poll.id, c.id, optionY.id);

	const refreshed = listPollsWithVotes(t.id).find((p) => p.id === poll.id)!;
	expect(refreshed.options.find((o) => o.id === optionX.id)!.voteCount).toBe(0);
	expect(refreshed.options.find((o) => o.id === optionY.id)!.voteCount).toBe(1);
	expect(refreshed.votes).toHaveLength(1);
	expect(refreshed.votes[0].optionId).toBe(optionY.id);

	const db = (ctx as { db: import('./db').DB }).db;
	const rows = db
		.select()
		.from(tripPollVotes)
		.where(eq(tripPollVotes.pollId, poll.id))
		.all();
	expect(rows).toHaveLength(1);
});

test('deletePoll removes poll, options, and votes and logs audit', () => {
	const u = makeUser('d@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const c = makeCompanion(t.id, 'Carol');
	const poll = createTripPoll(Number(u.id), t.id, 'Color?', ['Red', 'Blue']);
	const option = poll.options[0];
	castVote(Number(u.id), poll.id, c.id, option.id);

	removeTripPoll(Number(u.id), poll.id);

	const db = (ctx as { db: import('./db').DB }).db;
	expect(db.select().from(tripPolls).where(eq(tripPolls.id, poll.id)).get()).toBeUndefined();
	expect(db.select().from(tripPollOptions).where(eq(tripPollOptions.pollId, poll.id)).all()).toHaveLength(0);
	expect(db.select().from(tripPollVotes).where(eq(tripPollVotes.pollId, poll.id)).all()).toHaveLength(0);

	const logs = db
		.select()
		.from(auditLogs)
		.where(and(eq(auditLogs.entityType, 'trip_poll'), eq(auditLogs.entityId, poll.id)))
		.all();
	expect(logs.some((l: Record<string, unknown>) => l.action === 'create')).toBe(true);
	expect(logs.some((l: Record<string, unknown>) => l.action === 'vote')).toBe(true);
	expect(logs.some((l: Record<string, unknown>) => l.action === 'delete')).toBe(true);
});

test('non-editor cannot create, vote, or delete polls', () => {
	const owner = makeUser('o@x.c');
	const other = makeUser('n@x.c');
	const t = makeTrip(Number(owner.id), 'T');
	const c = makeCompanion(t.id, 'Dan');
	const poll = createTripPoll(Number(owner.id), t.id, 'Q?', ['A', 'B']);

	expect(() => createTripPoll(Number(other.id), t.id, 'Bad?', ['1', '2'])).toThrowError(
		expect.objectContaining({ status: 404 })
	);
	expect(() => castVote(Number(other.id), poll.id, c.id, poll.options[0].id)).toThrowError(
		expect.objectContaining({ status: 404 })
	);
	expect(() => removeTripPoll(Number(other.id), poll.id)).toThrowError(
		expect.objectContaining({ status: 404 })
	);
});

test('createPoll action validates input and redirects', async () => {
	const u = makeUser('ca@x.c');
	const t = makeTrip(Number(u.id), 'T');

	await expect(
		createPoll(
			event({ id: Number(u.id) }, t.id, {
				question: 'Where to?',
				options: ['Beach', 'Mountains', 'City']
			})
		)
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const db = (ctx as { db: import('./db').DB }).db;
	const polls = db.select().from(tripPolls).where(eq(tripPolls.tripId, t.id)).all();
	expect(polls).toHaveLength(1);
});

test('createPoll action returns fail for invalid input', async () => {
	const u = makeUser('ci@x.c');
	const t = makeTrip(Number(u.id), 'T');

	const result = await createPoll(event({ id: Number(u.id) }, t.id, { question: '', options: ['Only'] }));
	expect(result).toMatchObject({ status: 400, data: { error: expect.any(String) } });

	const db = (ctx as { db: import('./db').DB }).db;
	expect(db.select().from(tripPolls).where(eq(tripPolls.tripId, t.id)).all()).toHaveLength(0);
});

test('votePoll action casts a vote and redirects', async () => {
	const u = makeUser('va@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const c = makeCompanion(t.id, 'Eve');
	const poll = createTripPoll(Number(u.id), t.id, 'When?', ['Morning', 'Evening']);
	const option = poll.options.find((o) => o.label === 'Morning')!;

	await expect(
		votePoll(
			event({ id: Number(u.id) }, t.id, {
				pollId: String(poll.id),
				companionId: String(c.id),
				optionId: String(option.id)
			})
		)
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const db = (ctx as { db: import('./db').DB }).db;
	const votes = db.select().from(tripPollVotes).where(eq(tripPollVotes.pollId, poll.id)).all();
	expect(votes).toHaveLength(1);
	expect(votes[0].optionId).toBe(option.id);
});

test('deletePoll action removes a poll and redirects', async () => {
	const u = makeUser('da@x.c');
	const t = makeTrip(Number(u.id), 'T');
	const poll = createTripPoll(Number(u.id), t.id, 'What?', ['This', 'That']);

	await expect(deletePoll(event({ id: Number(u.id) }, t.id, { pollId: String(poll.id) }))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	const db = (ctx as { db: import('./db').DB }).db;
	expect(db.select().from(tripPolls).where(eq(tripPolls.id, poll.id)).get()).toBeUndefined();
});
