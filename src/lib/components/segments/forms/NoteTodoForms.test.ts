import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import NoteForm from './NoteForm.svelte';
import TodoForm from './TodoForm.svelte';

// Safety net for form-field consolidation: locks field names/required so a
// migration to shared components cannot silently drop/rename a field.
test('NoteForm renders expected fields', () => {
	const { body } = render(NoteForm, { props: {} });
	for (const f of ['title', 'detail_notes', 'startDate', 'startTime', 'startTz']) {
		expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
	}
	expect(body).toMatch(/<input[^>]*name="title"[^>]*required/);
	expect(body).toMatch(/<textarea[^>]*name="detail_notes"/);
});

test('NoteForm surfaces composite date errors', () => {
	const { body } = render(NoteForm, { props: { errors: { localStart: 'Bad time.', startTz: 'Pick tz.' } } });
	expect(body).toContain('Bad time.');
	expect(body).toContain('Pick tz.');
});

test('TodoForm renders expected fields', () => {
	const { body } = render(TodoForm, { props: {} });
	for (const f of ['title', 'detail_notes', 'startDate', 'startTime', 'startTz']) {
		expect(body, `expected name="${f}"`).toContain(`name="${f}"`);
	}
	expect(body).toMatch(/<input[^>]*name="title"[^>]*required/);
});

test('TodoForm surfaces composite date errors', () => {
	const { body } = render(TodoForm, { props: { errors: { title: 'Need text.', startDate: 'Bad date.' } } });
	expect(body).toContain('Need text.');
	expect(body).toContain('Bad date.');
});
