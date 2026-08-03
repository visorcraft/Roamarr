import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { HEARTBEAT_MS, subscribeUser, type LiveEvent } from '$lib/server/eventBus';
import { listViewableTripIdsForUser } from '$lib/server/repositories/tripsRepo';

/**
 * Live invalidation stream (Server-Sent Events). Emits `{type:'trip', id,
 * rev, origin}` events for trips the subscriber can view, plus a `shares`
 * hint when the subscriber's share graph changes. Live-only: nothing is
 * replayed; clients that reconnect simply refetch on the next event.
 *
 * Privacy: a subscriber only ever learns trip ids they could already load —
 * each connection caches the user's viewable-trip id set at subscribe time
 * and drops events outside it. The set is recomputed in place when a share
 * mutation publishes a `shares` user event, so no per-event DB reads happen
 * and revoked access stops delivery within one event.
 */
export const GET: RequestHandler = async ({ locals, request, getClientAddress }) => {
	const user = requireUser(locals);
	let ip = 'unknown';
	try {
		ip = getClientAddress();
	} catch {
		// best-effort; getClientAddress may throw in some environments
	}
	const limit = checkRateLimit(ip, 'api:events', { maxAttempts: 30 });
	if (!limit.allowed) throw error(429, 'Too many requests');

	let viewable = new Set(listViewableTripIdsForUser(user.id));
	// Assigned in start(); events can't fire synchronously before that because
	// publishers run on request/scheduler ticks after this handler returned.
	let send: (chunk: string) => void = () => {};

	const unsubscribe = subscribeUser(user.id, (event: LiveEvent) => {
		if (event.type === 'user') {
			if (event.kind === 'shares') {
				try {
					viewable = new Set(listViewableTripIdsForUser(user.id));
				} catch {
					// Keep the previous set on a transient DB error.
				}
				send(`event: shares\ndata: {"type":"shares"}\n\n`);
			}
			return;
		}
		if (!viewable.has(event.id)) return;
		send(`event: trip\ndata: ${JSON.stringify(event)}\n\n`);
	});
	if (!unsubscribe) throw error(429, 'Too many open event streams');

	let heartbeat: ReturnType<typeof setInterval> | null = null;
	let cleanedUp = false;
	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		if (heartbeat) clearInterval(heartbeat);
		unsubscribe();
	};

	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			send = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					cleanup();
				}
			};
			// Heartbeat comment keeps proxies and browsers from idling the socket out.
			heartbeat = setInterval(() => send(': hb\n\n'), HEARTBEAT_MS);
			// Hint the browser's reconnect delay for dropped connections.
			send('retry: 3000\n\n');
		},
		cancel() {
			cleanup();
		}
	});
	request.signal.addEventListener('abort', cleanup, { once: true });

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	});
};
