import { test, expect, beforeEach } from 'vitest';
import {
	checkRateLimit,
	resetRateLimit,
	DEFAULT_MAX_ATTEMPTS,
	DEFAULT_WINDOW_MS
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
