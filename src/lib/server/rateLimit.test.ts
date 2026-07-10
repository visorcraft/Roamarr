import { test, expect, beforeEach } from 'vitest';
import {
	checkRateLimit,
	resetRateLimit,
	pruneExpiredRateLimit,
	rateLimitSize,
	DEFAULT_MAX_ATTEMPTS,
	DEFAULT_WINDOW_MS,
	MAX_RATE_LIMIT_ENTRIES
} from './rateLimit';

beforeEach(() => resetRateLimit());

test('allows requests up to the limit', () => {
	const ip = '1.2.3.4';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
		expect(checkRateLimit(ip, 'login')).toEqual({ allowed: true });
	}
});

test('blocks requests over the limit and reports retryAfter', () => {
	const ip = '1.2.3.4';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'login');
	const result = checkRateLimit(ip, 'login');
	expect(result.allowed).toBe(false);
	expect(result.retryAfter).toBeGreaterThan(0);
	expect(result.retryAfter).toBeLessThanOrEqual(Math.ceil(DEFAULT_WINDOW_MS / 1000));
});

test('resets the counter after the window expires', async () => {
	const ip = '1.2.3.4';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'login', { windowMs: 5 });
	expect(checkRateLimit(ip, 'login', { windowMs: 5 }).allowed).toBe(false);
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(checkRateLimit(ip, 'login', { windowMs: 5 }).allowed).toBe(true);
});

test('keys are scoped by ip and route', () => {
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit('1.2.3.4', 'login');
	expect(checkRateLimit('1.2.3.5', 'login').allowed).toBe(true);
	expect(checkRateLimit('1.2.3.4', 'register').allowed).toBe(true);
});

test('resetRateLimit clears all entries', () => {
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
		checkRateLimit('1.2.3.4', 'login');
		checkRateLimit('1.2.3.4', 'register');
	}
	resetRateLimit();
	expect(checkRateLimit('1.2.3.4', 'login').allowed).toBe(true);
	expect(checkRateLimit('1.2.3.4', 'register').allowed).toBe(true);
});

test('resetRateLimit can clear a single route entry', () => {
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit('1.2.3.4', 'login');
	checkRateLimit('1.2.3.4', 'register');
	resetRateLimit('1.2.3.4', 'login');
	expect(checkRateLimit('1.2.3.4', 'login').allowed).toBe(true);
});

test('pruneExpiredRateLimit removes only expired buckets and reports the count', async () => {
	checkRateLimit('1.1.1.1', 'a', { windowMs: 5 });
	checkRateLimit('1.1.1.2', 'a', { windowMs: 5 });
	checkRateLimit('1.1.1.3', 'a', { windowMs: 60_000 }); // still fresh
	expect(rateLimitSize()).toBe(3);

	await new Promise((resolve) => setTimeout(resolve, 10));

	expect(pruneExpiredRateLimit()).toBe(2);
	expect(rateLimitSize()).toBe(1);
	// The surviving fresh bucket is untouched and still enforcing.
	expect(checkRateLimit('1.1.1.3', 'a', { windowMs: 60_000 }).allowed).toBe(true);
});

test('caps the store at MAX_RATE_LIMIT_ENTRIES by evicting when full', () => {
	// Fill to the cap with unexpired buckets.
	for (let i = 0; i < MAX_RATE_LIMIT_ENTRIES; i++) {
		checkRateLimit(`10.0.${(i >> 8) & 0xff}.${i & 0xff}`, `r${i}`, { windowMs: 60_000 });
	}
	expect(rateLimitSize()).toBe(MAX_RATE_LIMIT_ENTRIES);

	// One more distinct bucket must still be admitted without growing past the cap.
	expect(checkRateLimit('203.0.113.7', 'brand-new', { windowMs: 60_000 }).allowed).toBe(true);
	expect(rateLimitSize()).toBeLessThanOrEqual(MAX_RATE_LIMIT_ENTRIES);
});
