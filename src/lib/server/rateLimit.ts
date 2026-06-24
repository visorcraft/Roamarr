const store = new Map<string, { count: number; resetAt: number }>();

export const DEFAULT_MAX_ATTEMPTS = 10;
export const DEFAULT_WINDOW_MS = 60_000;

interface RateLimitResult {
	allowed: boolean;
	retryAfter?: number;
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

	if (!entry || now >= entry.resetAt) {
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
