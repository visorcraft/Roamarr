import { render } from 'svelte/server';
import { test, expect, vi } from 'vitest';
import { m } from '$lib/paraglide/messages';
import NewCardPage from './new/+page.svelte';
import EditCardPage from './[id]/edit/+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => {} }));

const expectedMessages: Record<string, string> = {
	common_other: 'Other',
	cards_new_subtitle: 'Save a payment card and track its travel benefits.',
	card_action_add: 'Add card',
	card_action_save: 'Save card',
	card_nickname_label: 'Nickname',
	card_nickname_placeholder: 'e.g. Sapphire Reserve',
	card_network_label: 'Network',
	card_last4_label: 'Last 4',
	card_last4_placeholder: '1234',
	card_notes_label: 'Notes',
	card_notes_placeholder: 'Optional notes',
	card_benefits_title: 'Benefits',
	card_benefits_empty: 'No benefits added yet.',
	card_benefit_type_label: 'Benefit',
	card_benefit_type_trip_delay: 'Trip delay',
	card_benefit_type_baggage_delay: 'Baggage delay',
	card_benefit_type_trip_cancellation: 'Trip cancellation',
	card_benefit_coverage_label: 'Coverage',
	card_benefit_coverage_placeholder: '0',
	card_benefit_currency_label: 'Currency',
	card_benefit_currency_placeholder: 'USD',
	card_benefit_notes_label: 'Notes',
	card_benefit_notes_placeholder: 'Optional',
	card_benefit_template_label: 'Template',
	card_benefit_template_custom: 'Custom',
	card_benefit_action_add: 'Add benefit',
	card_benefit_action_edit: 'Edit',
	card_benefit_action_update: 'Update',
	card_benefit_action_delete: 'Delete',
	card_benefit_delete_confirm: 'Delete this benefit?'
};

test.each(Object.entries(expectedMessages))(
	'catalog message %s matches the English string',
	(key, expected) => {
		const fn = (m as Record<string, (i?: unknown) => string>)[key];
		expect(typeof fn).toBe('function');
		expect(fn()).toBe(expected);
	}
);

test('catalog message card_benefit_template_using matches the English string', () => {
	expect(m.card_benefit_template_using({ name: 'Airport Lounge' })).toBe('Using Airport Lounge');
});

test('reused catalog keys match the English strings', () => {
	expect(m.page_title_card_new()).toBe('Add card');
	expect(m.page_title_card_edit()).toBe('Edit card');
	expect(m.common_cancel()).toBe('Cancel');
});

test('new page renders its strings from the catalog', () => {
	const { body } = render(NewCardPage, {
		props: { data: {}, form: undefined } as any
	});
	expect(body).toContain('Save a payment card and track its travel benefits.');
	expect(body).toMatch(/for="nickname">Nickname(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="e.g. Sapphire Reserve"');
	expect(body).toMatch(/for="network">Network(?:<!---->)?<\/label>/);
	expect(body).toMatch(/for="last4">Last 4(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="1234"');
	expect(body).toMatch(/for="notes">Notes(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="Optional notes"');
	expect(body).toMatch(/>\s*(?:<!---->)?Cancel(?:<!---->)?<\/button>/);
	const addButton = body.match(/<button[^>]*>Add card<\/button>/);
	expect(addButton).toBeTruthy();
	expect(addButton![0]).not.toContain('disabled');
	expect(body).toContain('>Other</option>');
});

function buildEditData(overrides: { benefits?: unknown[] } = {}) {
	return {
		card: { nickname: 'Sapphire Reserve', network: 'visa', last4: '1234', notes: null },
		benefits: overrides.benefits ?? [],
		templates: [{ id: 3, name: 'Airport Lounge', benefitType: 'trip_delay' }],
		user: { defaultCurrency: 'USD' }
	} as any;
}

test('edit page renders its strings from the catalog with no benefits', () => {
	const { body } = render(EditCardPage, {
		props: { data: buildEditData(), form: undefined } as any
	});
	expect(body).toMatch(/<h1[^>]*>Edit card/);
	expect(body).toContain('value="Sapphire Reserve"');
	expect(body).toContain('Save card');
	expect(body).toContain('Benefits');
	expect(body).toContain('No benefits added yet.');
	expect(body).toMatch(/for="templateId">Template(?:<!---->)?<\/label>/);
	expect(body).toMatch(/<select[^>]*\bid="templateId"[^>]*\bname="templateId"[^>]*>/);
	expect(body).toContain('>Custom</option>');
	expect(body).toContain('Airport Lounge (Trip delay)');
	expect(body).toMatch(/for="benefitType">Benefit(?:<!---->)?<\/label>/);
	expect(body).toContain('Trip delay');
	expect(body).toContain('Baggage delay');
	expect(body).toContain('Trip cancellation');
	expect(body).toMatch(/for="coverageAmount">Coverage(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="0"');
	expect(body).toMatch(/for="currency">Currency(?:<!---->)?<\/label>/);
	expect(body).toContain('placeholder="USD"');
	expect(body).toContain('placeholder="Optional"');
	expect(body).toContain('Add benefit');
	expect(body).not.toContain('Delete this benefit?');
});

test('edit page renders its strings from the catalog with one benefit', () => {
	const { body } = render(EditCardPage, {
		props: {
			data: buildEditData({
				benefits: [{ id: 7, benefitType: 'trip_delay', coverageAmount: 500, currency: 'USD', notes: null }]
			}),
			form: undefined
		} as any
	});
	expect(body).not.toContain('No benefits added yet.');
	expect(body).toMatch(/>\s*Edit\s*<\/button>/);
	expect(body).toMatch(/>\s*(?:<!---->)?Delete(?:<!---->)?<\/button>/);
	expect(body).toContain('Delete this benefit?');
});
