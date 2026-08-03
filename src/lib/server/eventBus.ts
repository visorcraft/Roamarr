import { EventEmitter } from 'node:events';

/**
 * In-process live-event bus backing the `/api/events` SSE stream.
 *
 * Roamarr ships as a single Node process, so a plain EventEmitter is
 * sufficient: publishers (repositories/server modules) and subscribers (SSE
 * connections) always live in the same process. A multi-process deployment
 * would need an external broker (Redis pub/sub, NATS, …) — out of scope.
 *
 * The bus is deliberately dumb: it carries minimal invalidation hints
 * (`{type:'trip', id, rev, origin}`), never data. Per-subscriber
 * authorization filtering happens in the stream endpoint, which keeps a
 * cached viewable-trip set per connection; the bus itself never touches the
 * database, so repositories can import it without import cycles.
 */

export const MAX_STREAMS_PER_USER = 5;
export const MAX_STREAMS_TOTAL = 500;
/** How often the SSE endpoint emits a heartbeat comment to keep proxies alive. */
export const HEARTBEAT_MS = 25_000;

export interface TripChangedEvent {
	type: 'trip';
	id: number;
	/** Monotonic per-trip counter (in-memory; resets on process restart). */
	rev: number;
	/** Reserved for echo suppression; currently always null (see docs/realtime.md). */
	origin: string | null;
}

export interface UserChangedEvent {
	type: 'user';
	/** e.g. 'shares' — the user's trip-share graph changed. */
	kind: string;
}

export type LiveEvent = TripChangedEvent | UserChangedEvent;

const emitter = new EventEmitter();
// Connection caps are enforced explicitly in subscribeUser; silence the
// default 10-listener warning instead of raising the limit.
emitter.setMaxListeners(0);

const tripRevs = new Map<number, number>();
const streamsPerUser = new Map<number, number>();
let totalStreams = 0;

export function publishTripChanged(
	tripId: number,
	opts: { originClientId?: string | null } = {}
): TripChangedEvent {
	const rev = (tripRevs.get(tripId) ?? 0) + 1;
	tripRevs.set(tripId, rev);
	const event: TripChangedEvent = { type: 'trip', id: tripId, rev, origin: opts.originClientId ?? null };
	emitter.emit('trip', event);
	return event;
}

export function publishUserChanged(userId: number, kind: string): UserChangedEvent {
	const event: UserChangedEvent = { type: 'user', kind };
	emitter.emit(userEventName(userId), event);
	return event;
}

/** Convenience for share mutations: flag several users' share graphs as changed. */
export function publishSharesChanged(userIds: Iterable<number>) {
	for (const userId of userIds) publishUserChanged(userId, 'shares');
}

/**
 * Register a connection-scoped listener for everything addressed to a user:
 * all trip events (the caller filters by viewability) plus that user's
 * user-scoped events. Returns an idempotent unsubscribe, or `null` when the
 * per-user or total connection cap is reached.
 */
export function subscribeUser(userId: number, onEvent: (event: LiveEvent) => void): (() => void) | null {
	if ((streamsPerUser.get(userId) ?? 0) >= MAX_STREAMS_PER_USER) return null;
	if (totalStreams >= MAX_STREAMS_TOTAL) return null;

	const onTrip = (event: TripChangedEvent) => onEvent(event);
	const onUser = (event: UserChangedEvent) => onEvent(event);
	const userEvent = userEventName(userId);
	emitter.on('trip', onTrip);
	emitter.on(userEvent, onUser);
	streamsPerUser.set(userId, (streamsPerUser.get(userId) ?? 0) + 1);
	totalStreams += 1;

	let active = true;
	return () => {
		if (!active) return;
		active = false;
		emitter.off('trip', onTrip);
		emitter.off(userEvent, onUser);
		const remaining = (streamsPerUser.get(userId) ?? 1) - 1;
		if (remaining <= 0) streamsPerUser.delete(userId);
		else streamsPerUser.set(userId, remaining);
		totalStreams -= 1;
	};
}

function userEventName(userId: number) {
	return `user:${userId}`;
}

/** Current per-trip revision. Exported for tests/diagnostics. */
export function currentTripRev(tripId: number): number {
	return tripRevs.get(tripId) ?? 0;
}

/** Open-stream counts. Exported for tests/diagnostics. */
export function streamCounts(): { total: number; perUser: ReadonlyMap<number, number> } {
	return { total: totalStreams, perUser: streamsPerUser };
}
