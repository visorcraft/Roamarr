import { test, expect, afterEach } from 'vitest';
import {
	MAX_STREAMS_PER_USER,
	MAX_STREAMS_TOTAL,
	currentTripRev,
	publishSharesChanged,
	publishTripChanged,
	publishUserChanged,
	streamCounts,
	subscribeUser,
	type LiveEvent
} from './eventBus';

const cleanups: Array<() => void> = [];
afterEach(() => {
	while (cleanups.length) cleanups.pop()!();
});

function subscribe(userId: number, events: LiveEvent[]) {
	const unsub = subscribeUser(userId, (e) => events.push(e));
	if (unsub) cleanups.push(unsub);
	return unsub;
}

test('delivers published trip events to subscribers with monotonic per-trip revs', () => {
	const events: LiveEvent[] = [];
	subscribe(1, events);
	const first = publishTripChanged(10);
	const second = publishTripChanged(10);
	const otherTrip = publishTripChanged(20);
	expect(first.rev).toBe(1);
	expect(second.rev).toBe(2);
	expect(otherTrip.rev).toBe(1);
	expect(currentTripRev(10)).toBe(2);
	expect(events.map((e) => (e.type === 'trip' ? [e.id, e.rev] : null))).toEqual([
		[10, 1],
		[10, 2],
		[20, 1]
	]);
});

test('unsubscribe stops delivery and frees the per-user slot', () => {
	const events: LiveEvent[] = [];
	const unsub = subscribe(1, events);
	publishTripChanged(10);
	unsub!();
	publishTripChanged(10);
	expect(events).toHaveLength(1);
	expect(streamCounts().total).toBe(0);
	// The freed slot allows a new subscription immediately.
	expect(subscribe(1, [])).not.toBeNull();
});

test('user events reach only that user; publishSharesChanged fans out', () => {
	const a: LiveEvent[] = [];
	const b: LiveEvent[] = [];
	subscribe(1, a);
	subscribe(2, b);
	publishUserChanged(1, 'shares');
	expect(a).toEqual([{ type: 'user', kind: 'shares' }]);
	expect(b).toEqual([]);

	publishSharesChanged([1, 2]);
	expect(a).toHaveLength(2);
	expect(b).toHaveLength(1);
	// Trip events still reach every subscriber (the endpoint filters viewability).
	publishTripChanged(5);
	expect(a.at(-1)).toMatchObject({ type: 'trip', id: 5 });
	expect(b.at(-1)).toMatchObject({ type: 'trip', id: 5 });
});

test('caps streams per user', () => {
	const events: LiveEvent[] = [];
	for (let i = 0; i < MAX_STREAMS_PER_USER; i++) {
		expect(subscribe(7, events)).not.toBeNull();
	}
	expect(subscribeUser(7, () => {})).toBeNull();
	// Another user is unaffected.
	expect(subscribe(8, events)).not.toBeNull();
	expect(streamCounts().perUser.get(7)).toBe(MAX_STREAMS_PER_USER);
});

test('caps total streams across users', () => {
	const unsubs: Array<() => void> = [];
	for (let userId = 1; userId <= MAX_STREAMS_TOTAL; userId++) {
		const unsub = subscribeUser(userId, () => {});
		expect(unsub).not.toBeNull();
		unsubs.push(unsub!);
	}
	expect(subscribeUser(MAX_STREAMS_TOTAL + 1, () => {})).toBeNull();
	expect(streamCounts().total).toBe(MAX_STREAMS_TOTAL);
	for (const unsub of unsubs) unsub();
	expect(streamCounts().total).toBe(0);
});

test('double unsubscribe is a no-op', () => {
	const unsub = subscribeUser(1, () => {})!;
	cleanups.push(unsub);
	unsub();
	unsub();
	expect(streamCounts().total).toBe(0);
});
