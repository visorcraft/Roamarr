import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => {} }));

const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

test('draws the emergency-contact separator with the theme line colour', () => {
	expect(src).toContain('class="mt-6 grid gap-3 border-t border-line pt-5 sm:grid-cols-2"');
	expect(src).not.toContain('border-white/');
});

function buildContact(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		name: 'Ada Lovelace',
		relationship: null,
		phone: null,
		email: null,
		isPrimary: false,
		...overrides
	} as any;
}

function buildData(contacts = [buildContact()]) {
	return { emergencyContacts: contacts } as any;
}

function stripComments(html: string) {
	return html.replace(/<!--[\s\S]*?-->/g, '');
}

test('delete control is a confirm trigger inside its delete form', () => {
	const contacts = [
		buildContact({ id: 1, name: 'Ada Lovelace' }),
		buildContact({ id: 7, name: 'Grace Hopper' })
	];
	const { body } = render(Page, { props: { data: buildData(contacts), form: null } as any });
	const forms = [...body.matchAll(/<form[^>]*action="\?\/deleteEmergencyContact"[^>]*>([\s\S]*?)<\/form>/g)];
	expect(forms).toHaveLength(2);
	for (const contact of contacts) {
		const form = forms.find((f) => f[1].includes(`value="${contact.id}"`));
		expect(form, `delete form for contact ${contact.id}`).toBeTruthy();
		const inner = form![1];
		expect(inner).toContain(`<input type="hidden" name="id" value="${contact.id}"`);
		const buttons = inner.match(/<button[\s\S]*?<\/button>/g) ?? [];
		const trigger = buttons.find(
			(b) => b.includes('type="button"') && b.includes(`aria-label="Delete ${contact.name}"`)
		);
		expect(trigger).toBeTruthy();
		expect(stripComments(trigger!).replace(/<[^>]+>/g, '').trim()).toBe('Delete');
		expect(stripComments(inner)).toContain(`Delete ${contact.name}? This cannot be undone.`);
		const submitButtons = inner.match(/type="submit"/g) ?? [];
		expect(submitButtons).toHaveLength(1);
		expect(inner.indexOf('type="submit"')).toBeGreaterThan(inner.indexOf('<dialog'));
	}
});

test('no inline svg remains', () => {
	expect(src).not.toContain('<svg');
	expect(src).toContain('<Icon name="edit"');
});

test('failed submit renders an alert', () => {
	const { body } = render(Page, {
		props: { data: buildData(), form: { error: 'Failed to update contact' } } as any
	});
	expect(body).toContain('role="alert"');
	expect(body).toContain('Failed to update contact');
});

test('submit buttons start idle', () => {
	const { body } = render(Page, {
		props: { data: buildData(), form: null } as any
	});
	expect(body).toContain('aria-busy="false"');
	const buttons = body.match(/<button[\s\S]*?<\/button>/g) ?? [];
	const addButton = buttons.find((b) => stripComments(b).replace(/<[^>]+>/g, '').trim() === 'Add contact');
	expect(addButton).toBeTruthy();
	expect(addButton).not.toContain('disabled');
	expect(body).toContain('aria-label="Edit Ada Lovelace"');
});
