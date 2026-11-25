import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard, createCopyFeedback } from './copy';

function makeTextarea() {
	return {
		value: '',
		setAttribute: vi.fn(),
		style: {} as Record<string, string>,
		focus: vi.fn(),
		select: vi.fn(),
		setSelectionRange: vi.fn(),
		remove: vi.fn()
	};
}

function makeDocument(options: { execCommandResult?: boolean | (() => boolean) } = {}) {
	const textarea = makeTextarea();
	const active = { focus: vi.fn() };
	const body = { appendChild: vi.fn() };
	const execCommand =
		typeof options.execCommandResult === 'function'
			? options.execCommandResult
			: vi.fn(() => options.execCommandResult ?? true);
	const doc = {
		body,
		createElement: vi.fn(() => textarea),
		execCommand,
		activeElement: active
	};
	return { doc, textarea, active, body, execCommand };
}

describe('copyToClipboard', () => {
	beforeEach(() => {
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
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

	it('prefers the async API when a document is present', async () => {
		const { doc } = makeDocument();
		vi.stubGlobal('document', doc);
		(globalThis.navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

		const result = await copyToClipboard('hello world');

		expect(result).toBe(true);
		expect(doc.execCommand).not.toHaveBeenCalled();
		expect(doc.createElement).not.toHaveBeenCalled();
	});

	it('falls back to the legacy copy when the clipboard API is absent', async () => {
		vi.stubGlobal('navigator', {});
		const { doc, textarea, body } = makeDocument();
		vi.stubGlobal('document', doc);

		const result = await copyToClipboard('hello world');

		expect(result).toBe(true);
		expect(doc.execCommand).toHaveBeenCalledTimes(1);
		expect(doc.execCommand).toHaveBeenCalledWith('copy');
		expect(textarea.value).toBe('hello world');
		expect(body.appendChild).toHaveBeenCalledTimes(1);
		expect(body.appendChild).toHaveBeenCalledWith(textarea);
		expect(textarea.remove).toHaveBeenCalledTimes(1);
	});

	it('falls back to the legacy copy when writeText rejects', async () => {
		(globalThis.navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error('denied')
		);
		const { doc, textarea } = makeDocument();
		vi.stubGlobal('document', doc);

		const result = await copyToClipboard('hello world');

		expect(result).toBe(true);
		expect(doc.execCommand).toHaveBeenCalledTimes(1);
		expect(textarea.remove).toHaveBeenCalledTimes(1);
	});

	it('returns false and removes the textarea when the legacy copy reports failure', async () => {
		vi.stubGlobal('navigator', {});
		const { doc, textarea } = makeDocument({ execCommandResult: false });
		vi.stubGlobal('document', doc);

		const result = await copyToClipboard('hello world');

		expect(result).toBe(false);
		expect(textarea.remove).toHaveBeenCalledTimes(1);
	});

	it('returns false and removes the textarea when the legacy copy throws', async () => {
		vi.stubGlobal('navigator', {});
		const { doc, textarea } = makeDocument({
			execCommandResult: () => {
				throw new Error('boom');
			}
		});
		vi.stubGlobal('document', doc);

		const result = await copyToClipboard('hello world');

		expect(result).toBe(false);
		expect(textarea.remove).toHaveBeenCalledTimes(1);
	});

	it('returns false with no document global and no clipboard', async () => {
		vi.stubGlobal('navigator', {});

		const result = await copyToClipboard('hello world');

		expect(result).toBe(false);
	});
});

describe('createCopyFeedback', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('reports copied then idle after the duration', () => {
		const onChange = vi.fn();
		const feedback = createCopyFeedback(onChange);

		feedback.report(true);

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenNthCalledWith(1, 'copied');

		vi.advanceTimersByTime(2000);

		expect(onChange).toHaveBeenCalledTimes(2);
		expect(onChange).toHaveBeenNthCalledWith(2, 'idle');
	});

	it('reports failed then idle after the duration', () => {
		const onChange = vi.fn();
		const feedback = createCopyFeedback(onChange);

		feedback.report(false);

		expect(onChange).toHaveBeenNthCalledWith(1, 'failed');

		vi.advanceTimersByTime(2000);

		expect(onChange).toHaveBeenNthCalledWith(2, 'idle');
	});

	it('re-arms the timer on repeated reports', () => {
		const onChange = vi.fn();
		const feedback = createCopyFeedback(onChange);

		feedback.report(true);
		vi.advanceTimersByTime(1500);
		feedback.report(true);

		vi.advanceTimersByTime(1500);

		expect(onChange).not.toHaveBeenCalledWith('idle');

		vi.advanceTimersByTime(500);

		expect(onChange).toHaveBeenCalledWith('idle');
	});

	it('dispose cancels the pending reset', () => {
		const onChange = vi.fn();
		const feedback = createCopyFeedback(onChange);

		feedback.report(true);
		feedback.dispose();

		vi.advanceTimersByTime(5000);

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).not.toHaveBeenCalledWith('idle');
	});
});
