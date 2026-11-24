import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
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

const expectedNoteMessages: Record<string, string> = {
	note_title_label: 'Note title',
	note_title_placeholder: 'Enter note title',
	note_body_label: 'Note',
	note_body_placeholder: 'Enter note',
	note_markdown_hint: 'Markdown supported',
	note_date_label: 'Date',
	note_time_label: 'Time'
};
const expectedTodoMessages: Record<string, string> = {
	todo_title_label: 'Todo item',
	todo_title_placeholder: 'What needs to be done?',
	todo_due_date_label: 'Due date',
	todo_due_time_label: 'Due time',
	todo_notes_label: 'Notes',
	todo_notes_placeholder: 'Additional details (optional)'
};

test.each(Object.entries({ ...expectedNoteMessages, ...expectedTodoMessages }))('catalog message %s matches the English string', (key, expected) => {
	const fn = (m as Record<string, (i?: unknown) => string>)[key];
	expect(typeof fn).toBe('function');
	expect(fn()).toBe(expected);
});

test('NoteForm renders its labels, placeholders, and hint from the catalog', () => {
	const { body } = render(NoteForm, { props: {} });
	for (const expected of Object.values(expectedNoteMessages)) {
		expect(body).toContain(expected);
	}
	expect(body).toContain('placeholder="Enter note title"');
	expect(body).toContain('placeholder="Enter note"');
	expect(body).toMatch(/for="startTz">Timezone<\/label>/);
});

test('TodoForm renders its labels and placeholders from the catalog', () => {
	const { body } = render(TodoForm, { props: {} });
	for (const expected of Object.values(expectedTodoMessages)) {
		expect(body).toContain(expected);
	}
	expect(body).toContain('placeholder="What needs to be done?"');
	expect(body).toContain('placeholder="Additional details (optional)"');
	expect(body).toMatch(/for="startTz">Timezone<\/label>/);
});

test('NoteForm and TodoForm read their strings from the catalog, not literals', () => {
	const noteSource = readFileSync(new URL('./NoteForm.svelte', import.meta.url), 'utf8');
	const todoSource = readFileSync(new URL('./TodoForm.svelte', import.meta.url), 'utf8');
	for (const [source, table, prefix] of [
		[noteSource, expectedNoteMessages, 'note'],
		[todoSource, expectedTodoMessages, 'todo']
	] as const) {
		expect(source).toContain("from '$lib/paraglide/messages'");
		expect(source).toContain('m.datetime_timezone_label()');
		expect(source).not.toContain('>Timezone</label>');
		const used = [...new Set([...source.matchAll(new RegExp(`m\\.(${prefix}_[a-z_]+)\\(\\)`, 'g'))].map(([, key]) => key))].sort();
		expect(used).toEqual(Object.keys(table).sort());
	}
});

test('NoteForm and TodoForm no longer hardcode their visible strings', () => {
	const noteSource = readFileSync(new URL('./NoteForm.svelte', import.meta.url), 'utf8');
	const todoSource = readFileSync(new URL('./TodoForm.svelte', import.meta.url), 'utf8');
	for (const literal of [
		'label="Note title"',
		'placeholder="Enter note title"',
		'label="Note"',
		'placeholder="Enter note"',
		'hint="Markdown supported"',
		'label="Date"',
		'label="Time"'
	]) {
		expect(noteSource).not.toContain(literal);
	}
	for (const literal of [
		'label="Todo item"',
		'placeholder="What needs to be done?"',
		'label="Due date"',
		'label="Due time"',
		'label="Notes"',
		'placeholder="Additional details (optional)"'
	]) {
		expect(todoSource).not.toContain(literal);
	}
});
