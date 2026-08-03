import { test, expect, vi, beforeEach, afterEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { tripShares, trips, users } from '$lib/server/db/mongrelSchema';
import { makeUser, makeTrip } from '../../../../tests/helpers';
import { resetRateLimit } from '$lib/server/rateLimit';
import { publishTripChanged, streamCounts } from '$lib/server/eventBus';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';

const decoder = new TextDecoder();
const openReaders: Array<ReadableStreamDefaultReader<Uint8Array>> = [];
// A timed-out readChunk leaves its read pending; the next call must reuse it,
// otherwise the chunk that arrives later resolves the abandoned read instead.
const pendingReads = new WeakMap<
	ReadableStreamDefaultReader<Uint8Array>,
	Promise<ReadableStreamReadResult<Uint8Array>>
>();

beforeEach(() => {
	ctx.kit.deleteFrom(tripShares).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

afterEach(async () => {
	while (openReaders.length) await openReaders.pop()!.cancel();
});

function makeEvent(user: unknown, signal?: AbortSignal) {
	return {
		locals: { user },
		request: new Request('http://localhost/api/events', { signal }),
		getClientAddress: () => '127.0.0.1'
	} as never;
}

async function openStream(user: unknown, signal?: AbortSignal) {
	const res = await GET(makeEvent(user, signal));
	expect(res.status).toBe(200);
	const reader = res.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
	openReaders.push(reader);
	// First chunk is always the reconnect-hint prologue.
	const prologue = decoder.decode((await reader.read()).value);
	expect(prologue).toContain('retry:');
	return reader;
}

/** Read one chunk, or null when nothing arrives within `ms`. */
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, ms = 200): Promise<string | null> {
	const pending = pendingReads.get(reader) ?? reader.read();
	pendingReads.delete(reader);
	const result = await Promise.race([
		pending,
		new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
	]);
	if (!result) {
		pendingReads.set(reader, pending);
		return null;
	}
	if (result.done || !result.value) return null;
	return decoder.decode(result.value);
}

test('rejects unauthenticated requests with 401', async () => {
	await expect(GET(makeEvent(null))).rejects.toMatchObject({ status: 401 });
});

test('streams SSE headers for a signed-in user', async () => {
	const user = makeUser(ctx.kit);
	const res = await GET(makeEvent(user));
	expect(res.status).toBe(200);
	expect(res.headers.get('content-type')).toBe('text/event-stream');
	expect(res.headers.get('cache-control')).toBe('no-cache');
	await res.body!.cancel();
});

test('delivers only trips the subscriber can view', async () => {
	const owner = makeUser(ctx.kit, { email: 'o@x.c' });
	const viewer = makeUser(ctx.kit, { email: 'v@x.c' });
	const shared = makeTrip(ctx.kit, owner.id, { name: 'Shared' });
	const privateTrip = makeTrip(ctx.kit, owner.id, { name: 'Private' });
	tripsRepo.createShare({ tripId: shared.id, sharedWithUserId: viewer.id });

	const reader = await openStream(viewer);
	publishTripChanged(privateTrip.id);
	expect(await readChunk(reader, 150)).toBeNull();

	publishTripChanged(shared.id);
	const chunk = await readChunk(reader);
	expect(chunk).toContain('event: trip');
	expect(chunk).toContain(`"id":${shared.id}`);
	expect(chunk).not.toContain(`"id":${privateTrip.id}`);
});

test('share mutations refresh the subscriber viewable set', async () => {
	const owner = makeUser(ctx.kit, { email: 'o@x.c' });
	const viewer = makeUser(ctx.kit, { email: 'v@x.c' });
	const trip = makeTrip(ctx.kit, owner.id, { name: 'T' });

	const reader = await openStream(viewer);
	publishTripChanged(trip.id);
	expect(await readChunk(reader, 150)).toBeNull();

	// Granting a share notifies the viewer and unlocks delivery.
	const share = tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: viewer.id });
	expect(await readChunk(reader)).toContain('event: shares');
	publishTripChanged(trip.id);
	expect(await readChunk(reader)).toContain(`"id":${trip.id}`);

	// Revoking it stops delivery again.
	tripsRepo.deleteShare(share.id);
	expect(await readChunk(reader)).toContain('event: shares');
	publishTripChanged(trip.id);
	expect(await readChunk(reader, 150)).toBeNull();
});

test('heartbeats keep the stream alive and abort cleans up the subscription', async () => {
	vi.useFakeTimers();
	try {
		const user = makeUser(ctx.kit);
		const controller = new AbortController();
		const res = await GET(makeEvent(user, controller.signal));
		const reader = res.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
		openReaders.push(reader);
		await reader.read(); // prologue
		expect(streamCounts().total).toBe(1);

		await vi.advanceTimersByTimeAsync(25_000);
		const beat = decoder.decode((await reader.read()).value);
		expect(beat).toContain(': hb');

		controller.abort();
		expect(streamCounts().total).toBe(0);
	} finally {
		vi.useRealTimers();
	}
});

test('caps concurrent streams per user with 429', async () => {
	const user = makeUser(ctx.kit);
	for (let i = 0; i < 5; i++) await openStream(user);
	await expect(GET(makeEvent(user))).rejects.toMatchObject({ status: 429 });
});

test('rate limits repeated connection attempts', async () => {
	const user = makeUser(ctx.kit);
	for (let i = 0; i < 30; i++) {
		const res = await GET(makeEvent(user));
		expect(res.status).toBe(200);
		await res.body!.cancel();
	}
	await expect(GET(makeEvent(user))).rejects.toMatchObject({ status: 429 });
});
