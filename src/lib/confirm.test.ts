import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { confirmHandler } from './confirm';

describe('confirmHandler', () => {
	beforeEach(() => {
		vi.stubGlobal('confirm', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('allows the default action when the user confirms', () => {
		(globalThis.confirm as ReturnType<typeof vi.fn>).mockReturnValue(true);
		const preventDefault = vi.fn();
		const handler = confirmHandler('Are you sure?');

		handler({ preventDefault } as unknown as Event);

		expect(globalThis.confirm).toHaveBeenCalledWith('Are you sure?');
		expect(preventDefault).not.toHaveBeenCalled();
	});

	it('prevents the default action when the user cancels', () => {
		(globalThis.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
		const preventDefault = vi.fn();
		const handler = confirmHandler('Are you sure?');

		handler({ preventDefault } as unknown as Event);

		expect(globalThis.confirm).toHaveBeenCalledWith('Are you sure?');
		expect(preventDefault).toHaveBeenCalledOnce();
	});
});
