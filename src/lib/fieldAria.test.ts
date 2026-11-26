import { describe, expect, test } from 'vitest';
import { resolveFieldAria } from './fieldAria';

describe('resolveFieldAria', () => {
	test('single errorKey links the error id', () => {
		const state = resolveFieldAria({ id: 'email', errorKey: 'email', errors: { email: 'Required' } });
		expect(state.errorPairs).toEqual([{ id: 'email-email-error', msg: 'Required' }]);
		expect(state.invalid).toBe(true);
		expect(state.hintId).toBeUndefined();
		expect(state.describedBy).toBe('email-email-error');
	});

	test('array errorKey links each error id in order', () => {
		const state = resolveFieldAria({
			id: 'trip',
			errorKey: ['start', 'end'],
			errors: { start: 'Bad start', end: 'Bad end' }
		});
		expect(state.errorPairs).toEqual([
			{ id: 'trip-start-error', msg: 'Bad start' },
			{ id: 'trip-end-error', msg: 'Bad end' }
		]);
		expect(state.invalid).toBe(true);
		expect(state.describedBy).toBe('trip-start-error trip-end-error');
	});

	test('duplicate errorKey entries are deduplicated preserving order', () => {
		const state = resolveFieldAria({
			id: 'email',
			errorKey: ['email', 'email', 'email'],
			errors: { email: 'Required' }
		});
		expect(state.errorPairs).toEqual([{ id: 'email-email-error', msg: 'Required' }]);
		expect(state.describedBy).toBe('email-email-error');
	});

	test('missing errors yield no pairs, invalid false, and undefined describedBy', () => {
		const state = resolveFieldAria({ id: 'email', errorKey: 'email' });
		expect(state.errorPairs).toEqual([]);
		expect(state.invalid).toBe(false);
		expect(state.describedBy).toBeUndefined();
	});

	test('empty errors yield no pairs and no invalid', () => {
		const state = resolveFieldAria({ id: 'email', errorKey: 'email', errors: {} });
		expect(state.errorPairs).toEqual([]);
		expect(state.invalid).toBe(false);
		expect(state.describedBy).toBeUndefined();
	});

	test('keys with empty-string messages are dropped', () => {
		const state = resolveFieldAria({ id: 'email', errorKey: ['start', 'end'], errors: { start: '', end: 'Bad end' } });
		expect(state.errorPairs).toEqual([{ id: 'email-end-error', msg: 'Bad end' }]);
		expect(state.invalid).toBe(true);
		expect(state.describedBy).toBe('email-end-error');
	});

	test('hint only links the hint id', () => {
		const state = resolveFieldAria({ id: 'notes', errorKey: 'notes', hint: 'Markdown supported' });
		expect(state.hintId).toBe('notes-hint');
		expect(state.describedBy).toBe('notes-hint');
		expect(state.invalid).toBe(false);
	});

	test('foreign describedBy tokens come first, then hint, then errors', () => {
		const state = resolveFieldAria({
			id: 'email',
			errorKey: 'email',
			hint: 'We never share this',
			errors: { email: 'Required' },
			describedBy: '  edit-user-password-hint  another-hint '
		});
		expect(state.hintId).toBe('email-hint');
		expect(state.describedBy).toBe('edit-user-password-hint another-hint email-hint email-email-error');
	});

	test('foreign describedBy whitespace is split and trimmed', () => {
		const state = resolveFieldAria({ id: 'email', errorKey: 'email', describedBy: 'a   b\tc\nd' });
		expect(state.describedBy).toBe('a b c d');
	});

	test('empty or undefined result is undefined describedBy', () => {
		const empty = resolveFieldAria({ id: 'email', errorKey: 'email', errors: { email: '' } });
		expect(empty.describedBy).toBeUndefined();
		expect(empty.invalid).toBe(false);
		expect(empty.hintId).toBeUndefined();

		const undef = resolveFieldAria({ id: 'email', errorKey: 'email' });
		expect(undef.describedBy).toBeUndefined();
		expect(undef.invalid).toBe(false);
		expect(undef.errorPairs).toEqual([]);
	});
});
