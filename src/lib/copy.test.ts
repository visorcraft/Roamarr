import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard } from './copy';

describe('copyToClipboard', () => {
	beforeEach(() => {
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('writes text and returns true on success', async () => {
		(globalThis.navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

		const result = await copyToClipboard('hello world');

		expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith('hello world');
		expect(result).toBe(true);
	});

	it('returns false when writeText rejects', async () => {
		(globalThis.navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error('denied')
		);

		const result = await copyToClipboard('hello world');

		expect(result).toBe(false);
	});

	it('returns false when clipboard is unavailable', async () => {
		vi.stubGlobal('navigator', {});

		const result = await copyToClipboard('hello world');

		expect(result).toBe(false);
	});
});
