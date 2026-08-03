/**
 * Client side of the live invalidation stream (`/api/events`, SSE).
 *
 * Session-cookie pages only: EventSource cannot set Authorization or
 * X-Api-Token headers, so OAuth/API-key clients (scripts) should poll the
 * REST API instead. The stream carries invalidation hints, never data — a
 * `trip` event means "refetch if you have this trip open"; a `shares` event
 * means "your share graph changed, refetch". EventSource reconnects
 * automatically on dropped connections (honoring the server's `retry:` hint),
 * so no custom backoff is needed; error state is deliberately quiet.
 */

export interface LiveTripEvent {
	type: 'trip';
	id: number;
	rev: number;
	origin: string | null;
}

export interface LiveSharesEvent {
	type: 'shares';
}

export type LiveStreamEvent = LiveTripEvent | LiveSharesEvent;

/**
 * Trailing-edge coalescer: bursts of events within `waitMs` collapse into a
 * single `fn()` call, guarding against refetch storms when several mutations
 * land at once (e.g. a segment import or multi-expense edit).
 */
export function coalesceTrailing(fn: () => void, waitMs: number): { trigger: () => void; cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return {
		trigger() {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				fn();
			}, waitMs);
		},
		cancel() {
			if (timer) clearTimeout(timer);
			timer = null;
		}
	};
}

/**
 * Open the live stream and dispatch parsed events to `handler`. Returns a
 * close function. No-op (returns a trivial close) where EventSource is
 * unavailable (SSR, tests).
 */
export function subscribeLiveEvents(handler: (event: LiveStreamEvent) => void): () => void {
	if (typeof EventSource === 'undefined') return () => {};
	const source = new EventSource('/api/events');
	source.addEventListener('trip', (message) => {
		try {
			handler(JSON.parse((message as MessageEvent).data) as LiveTripEvent);
		} catch {
			// Ignore malformed events; the stream is best-effort.
		}
	});
	source.addEventListener('shares', () => handler({ type: 'shares' }));
	source.onerror = () => {
		// EventSource retries on its own; keep the console quiet.
	};
	return () => source.close();
}
