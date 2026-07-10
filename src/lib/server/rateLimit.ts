const store = new Map<string, { count: number; resetAt: number }>();

export const DEFAULT_MAX_ATTEMPTS = 10;
export const DEFAULT_WINDOW_MS = 60_000;

/**
 * Hard cap on tracked (ip, route) buckets. Without a cap, every distinct
 * client/route pair creates a permanent entry and the map grows without bound
 * for the process lifetime (a restart-cured memory leak, and O(n) scans in
 * {@link resetRateLimit}). When the cap is reached we first drop expired
 * buckets, then — if still full — evict the bucket closest to expiring
 * (smallest `resetAt`), which minimizes how long any throttling state is lost.
 */
export const MAX_RATE_LIMIT_ENTRIES = 50_000;

interface RateLimitResult {
	allowed: boolean;
	retryAfter?: number;
}

/**
 * Delete every bucket whose window has already expired. Returns the number of
 * entries removed. Called by the scheduler each tick so memory is reclaimed on
 * a cadence even without new requests, and exported for tests.
 */
export function pruneExpiredRateLimit(now: number = Date.now()): number {
	let removed = 0;
	for (const [key, entry] of store) {
		if (now >= entry.resetAt) {
			store.delete(key);
			removed += 1;
		}
	}
	return removed;
}

/** Current number of tracked buckets. Exported for tests/diagnostics. */
export function rateLimitSize(): number {
	return store.size;
}

function evictNearestExpiry(): void {
	let oldestKey: string | null = null;
	let oldestReset = Infinity;
	for (const [key, entry] of store) {
		if (entry.resetAt < oldestReset) {
			oldestReset = entry.resetAt;
			oldestKey = key;
		}
	}
	if (oldestKey !== null) store.delete(oldestKey);
}

export function checkRateLimit(
	ip: string,
	route: string,
	opts: { maxAttempts?: number; windowMs?: number } = {}
): RateLimitResult {
	const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
	const now = Date.now();
	const key = JSON.stringify([ip, route]);
	const entry = store.get(key);

	if (!entry) {
		// New bucket: bound the map before growing it.
		if (store.size >= MAX_RATE_LIMIT_ENTRIES) {
			pruneExpiredRateLimit(now);
			if (store.size >= MAX_RATE_LIMIT_ENTRIES) evictNearestExpiry();
		}
		store.set(key, { count: 1, resetAt: now + windowMs });
		return { allowed: true };
	}

	if (now >= entry.resetAt) {
		// Existing key, expired window: reset in place (no growth).
		store.set(key, { count: 1, resetAt: now + windowMs });
		return { allowed: true };
	}

	entry.count += 1;
	if (entry.count > maxAttempts) {
		return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
	}
	return { allowed: true };
}

export function resetRateLimit(ip?: string, route?: string) {
	if (!ip && !route) {
		store.clear();
		return;
	}
	for (const key of store.keys()) {
		const [kIp, kRoute] = JSON.parse(key);
		if ((!ip || kIp === ip) && (!route || kRoute === route)) {
			store.delete(key);
		}
	}
}
