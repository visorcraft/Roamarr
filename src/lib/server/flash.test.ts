import { test, expect, vi } from 'vitest';
import { flashCookieOptions, setFlash } from './flash';

test('flashCookieOptions uses lax sameSite and a short maxAge', () => {
	const opts = flashCookieOptions();
	expect(opts.path).toBe('/');
	expect(opts.httpOnly).toBe(true);
	expect(opts.sameSite).toBe('lax');
	expect(opts.maxAge).toBe(60);
});

test('setFlash writes the message to the flash cookie', () => {
	const cookies = { set: vi.fn() } as any;
	setFlash(cookies, 'Saved.');
	expect(cookies.set).toHaveBeenCalledTimes(1);
	expect(cookies.set).toHaveBeenCalledWith('flash', 'Saved.', expect.objectContaining({ path: '/' }));
});
