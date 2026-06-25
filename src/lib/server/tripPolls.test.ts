import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
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
import { eq, and } from 'drizzle-orm';

function event(user: { id: number }, tripId: number, body: Record<string, string | string[]>) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(body)) {
		if (Array.isArray(value)) {
			for (const v of value) params.append(key, v);
		} else {
			params.append(key, value);
		}
	}
	return {
		locals: { user } as App.Locals,
		params: { id: String(tripId) },
		request: new Request('http://localhost/trips/' + tripId, {
			method: 'POST',
			body: params
		})
	} as any;
}

test('create and list polls with options and vote counts', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'p@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const poll = createTripPoll(u.id, t.id, 'Where should we eat?', ['Italian', 'Sushi', 'Burgers']);

	const polls = listPollsWithVotes(t.id);
	expect(polls).toHaveLength(1);
	expect(polls[0].id).toBe(poll.id);
	expect(polls[0].question).toBe('Where should we eat?');
	expect(polls[0].options.map((o) => o.label)).toEqual(['Italian', 'Sushi', 'Burgers']);
	expect(polls[0].options.every((o) => o.voteCount === 0)).toBe(true);
});

test('vote records a vote and updates counts', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'v@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const c = db
		.insert(tripCompanions)
		.values({ tripId: t.id, name: 'Alice', category: 'adult' })
		.returning()
		.get();
	const poll = createTripPoll(u.id, t.id, 'Dinner?', ['A', 'B']);
	const optionA = poll.options.find((o) => o.label === 'A')!;

	castVote(u.id, poll.id, c.id, optionA.id);

	const polls = listPollsWithVotes(t.id);
	const refreshed = polls.find((p) => p.id === poll.id)!;
	expect(refreshed.options.find((o) => o.id === optionA.id)!.voteCount).toBe(1);
	expect(refreshed.votes).toContainEqual({ id: expect.any(Number), optionId: optionA.id, companionId: c.id });
});

test('changing vote replaces previous vote and keeps one per companion', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'cv@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const c = db
		.insert(tripCompanions)
		.values({ tripId: t.id, name: 'Bob', category: 'adult' })
		.returning()
		.get();
	const poll = createTripPoll(u.id, t.id, 'Plan?', ['X', 'Y']);
	const optionX = poll.options.find((o) => o.label === 'X')!;
	const optionY = poll.options.find((o) => o.label === 'Y')!;

	castVote(u.id, poll.id, c.id, optionX.id);
	castVote(u.id, poll.id, c.id, optionY.id);

	const refreshed = listPollsWithVotes(t.id).find((p) => p.id === poll.id)!;
	expect(refreshed.options.find((o) => o.id === optionX.id)!.voteCount).toBe(0);
	expect(refreshed.options.find((o) => o.id === optionY.id)!.voteCount).toBe(1);
	expect(refreshed.votes).toHaveLength(1);
	expect(refreshed.votes[0].optionId).toBe(optionY.id);

	const rows = db
		.select()
		.from(tripPollVotes)
		.where(eq(tripPollVotes.pollId, poll.id))
		.all();
	expect(rows).toHaveLength(1);
});

test('deletePoll removes poll, options, and votes and logs audit', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'd@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const c = db
		.insert(tripCompanions)
		.values({ tripId: t.id, name: 'Carol', category: 'adult' })
		.returning()
		.get();
	const poll = createTripPoll(u.id, t.id, 'Color?', ['Red', 'Blue']);
	const option = poll.options[0];
	castVote(u.id, poll.id, c.id, option.id);

	removeTripPoll(u.id, poll.id);

	expect(db.select().from(tripPolls).where(eq(tripPolls.id, poll.id)).get()).toBeUndefined();
	expect(db.select().from(tripPollOptions).where(eq(tripPollOptions.pollId, poll.id)).all()).toHaveLength(0);
	expect(db.select().from(tripPollVotes).where(eq(tripPollVotes.pollId, poll.id)).all()).toHaveLength(0);

	const logs = db
		.select()
		.from(auditLogs)
		.where(and(eq(auditLogs.entityType, 'trip_poll'), eq(auditLogs.entityId, poll.id)))
		.all();
	expect(logs.some((l) => l.action === 'create')).toBe(true);
	expect(logs.some((l) => l.action === 'delete')).toBe(true);
});

test('non-editor cannot create, vote, or delete polls', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const owner = db.insert(users).values({ email: 'o@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const other = db.insert(users).values({ email: 'n@x.c', passwordHash: 'x', displayName: 'N' }).returning().get();
	const t = db.insert(trips).values({ ownerId: owner.id, name: 'T' }).returning().get();
	const c = db
		.insert(tripCompanions)
		.values({ tripId: t.id, name: 'Dan', category: 'adult' })
		.returning()
		.get();
	const poll = createTripPoll(owner.id, t.id, 'Q?', ['A', 'B']);

	expect(() => createTripPoll(other.id, t.id, 'Bad?', ['1', '2'])).toThrowError(
		expect.objectContaining({ status: 404 })
	);
	expect(() => castVote(other.id, poll.id, c.id, poll.options[0].id)).toThrowError(
		expect.objectContaining({ status: 404 })
	);
	expect(() => removeTripPoll(other.id, poll.id)).toThrowError(
		expect.objectContaining({ status: 404 })
	);
});

test('createPoll action validates input and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'ca@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	await expect(
		createPoll(
			event(u, t.id, {
				question: 'Where to?',
				options: ['Beach', 'Mountains', 'City']
			})
		)
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const polls = db.select().from(tripPolls).where(eq(tripPolls.tripId, t.id)).all();
	expect(polls).toHaveLength(1);
});

test('createPoll action returns fail for invalid input', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'ci@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();

	const result = await createPoll(event(u, t.id, { question: '', options: ['Only'] }));
	expect(result).toMatchObject({ status: 400, data: { error: expect.any(String) } });
	expect(db.select().from(tripPolls).where(eq(tripPolls.tripId, t.id)).all()).toHaveLength(0);
});

test('votePoll action casts a vote and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'va@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const c = db
		.insert(tripCompanions)
		.values({ tripId: t.id, name: 'Eve', category: 'adult' })
		.returning()
		.get();
	const poll = createTripPoll(u.id, t.id, 'When?', ['Morning', 'Evening']);
	const option = poll.options.find((o) => o.label === 'Morning')!;

	await expect(
		votePoll(
			event(u, t.id, {
				pollId: String(poll.id),
				companionId: String(c.id),
				optionId: String(option.id)
			})
		)
	).rejects.toMatchObject({ status: 303, location: `/trips/${t.id}` });

	const votes = db.select().from(tripPollVotes).where(eq(tripPollVotes.pollId, poll.id)).all();
	expect(votes).toHaveLength(1);
	expect(votes[0].optionId).toBe(option.id);
});

test('deletePoll action removes a poll and redirects', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db.insert(users).values({ email: 'da@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T' }).returning().get();
	const poll = createTripPoll(u.id, t.id, 'What?', ['This', 'That']);

	await expect(deletePoll(event(u, t.id, { pollId: String(poll.id) }))).rejects.toMatchObject({
		status: 303,
		location: `/trips/${t.id}`
	});

	expect(db.select().from(tripPolls).where(eq(tripPolls.id, poll.id)).get()).toBeUndefined();
});
