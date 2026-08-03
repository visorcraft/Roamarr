import { test, expect, vi, afterEach } from 'vitest';
import { coalesceTrailing } from './liveEvents';

afterEach(() => {
	vi.useRealTimers();
});

test('coalesceTrailing collapses bursts into one trailing call', () => {
	vi.useFakeTimers();
	const fn = vi.fn();
	const c = coalesceTrailing(fn, 500);
	c.trigger();
	c.trigger();
	c.trigger();
	vi.advanceTimersByTime(499);
	expect(fn).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	expect(fn).toHaveBeenCalledTimes(1);
});

test('coalesceTrailing fires again for a later burst', () => {
	vi.useFakeTimers();
	const fn = vi.fn();
	const c = coalesceTrailing(fn, 500);
	c.trigger();
	vi.advanceTimersByTime(500);
	c.trigger();
	vi.advanceTimersByTime(500);
	expect(fn).toHaveBeenCalledTimes(2);
});

test('coalesceTrailing cancel drops a pending call', () => {
	vi.useFakeTimers();
	const fn = vi.fn();
	const c = coalesceTrailing(fn, 500);
	c.trigger();
	c.cancel();
	vi.advanceTimersByTime(1000);
	expect(fn).not.toHaveBeenCalled();
});
