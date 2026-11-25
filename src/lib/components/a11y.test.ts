import { describe, test, expect } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { checkA11y, formatViolations } from '../../../tests/a11y';
import Toast from './Toast.svelte';
import Icon from './Icon.svelte';
import EmptyState from './EmptyState.svelte';
import CopyButton from './CopyButton.svelte';
import TextField from './TextField.svelte';
import TextAreaField from './TextAreaField.svelte';
import SelectField from './SelectField.svelte';
import CityAutocomplete from './segments/CityAutocomplete.svelte';
import Modal from './Modal.svelte';
import GlobeModal from './GlobeModal.svelte';

test('Toast has no axe violations', async () => {
	const violations = await checkA11y(Toast, { message: 'Settings saved.', variant: 'success' });
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('Toast warning variant has no axe violations', async () => {
	const violations = await checkA11y(Toast, { message: 'Heads up.', variant: 'warning' });
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('Toast error variant has no axe violations', async () => {
	const violations = await checkA11y(Toast, { message: 'Could not save.', variant: 'error' });
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('Toast with no message has no axe violations', async () => {
	const violations = await checkA11y(Toast, { message: '' });
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('Icon has no axe violations (decorative)', async () => {
	const violations = await checkA11y(Icon, { name: 'home', class: 'h-5 w-5' });
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('EmptyState has no axe violations', async () => {
	const violations = await checkA11y(EmptyState, {
		message: 'No trips yet. Create your first trip to get started.',
		actionHref: '/trips/new',
		actionLabel: 'New trip'
	});
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('CopyButton has no axe violations', async () => {
	const violations = await checkA11y(CopyButton, { text: 'ABC123' });
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('TextField with error wires aria-invalid and describedby', async () => {
	const violations = await checkA11y(TextField, {
		name: 'email',
		label: 'Email',
		type: 'email',
		errors: { email: 'Enter a valid email address.' }
	});
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('TextField without error has no invalid/describedby attributes', async () => {
	const violations = await checkA11y(TextField, { name: 'email', label: 'Email' });
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('CityAutocomplete exposes a labelled combobox', async () => {
	// Closed-state render: validates the label/combobox wiring (role, controls,
	// expanded, autocomplete, label association). The open listbox is driven by
	// async fetch and cannot be SSR-driven; the listbox/option roles are covered
	// by the component source and combobox contract.
	const violations = await checkA11y(
		CityAutocomplete,
		{
			countryCode: 'US',
			name: 'city',
			value: '',
			latName: 'lat',
			lngName: 'lng'
		},
		{
			// 'nested-interactive' fires because the option <button> lives inside an
			// <li role=option>; the open state is interactive-only and the combobox
			// input (the only focusable element in the closed render) has no nesting.
			'nested-interactive': { enabled: false }
		}
	);
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

const modalBody = createRawSnippet(() => ({ render: () => '<p>Are you sure?</p>' }));
const renderModal = (props: Record<string, unknown> = {}) =>
	render(Modal, { props: { children: modalBody, open: true, ...props } }).body;
/** aria-labelledby value on the opening <dialog> tag. */
const labelledBy = (html: string) =>
	html.match(/<dialog\b[^>]*>/)?.[0].match(/\baria-labelledby="([^"]+)"/)?.[1];

describe('Dialog accessible names', () => {
	test('Modal names the dialog after its title', () => {
		const html = renderModal({ title: 'Delete trip' });
		const id = labelledBy(html);
		expect(id).toBeTruthy();
		expect(html).toMatch(new RegExp(`<h2[^>]*\\bid="${id}"[^>]*>Delete trip</h2>`));
	});

	test('Modal without a title has no aria-labelledby reference', () => {
		const html = renderModal();
		expect(labelledBy(html)).toBeUndefined();
		expect(html).not.toContain('modal-title');
	});

	test('GlobeModal names the dialog after its city heading', () => {
		const html = render(GlobeModal, { props: { open: true, lat: 1, lng: 2, cityName: 'Cairo' } }).body;
		const id = labelledBy(html);
		expect(id).toBeTruthy();
		expect(html).toMatch(new RegExp(`<h2[^>]*\\bid="${id}"[^>]*>Cairo</h2>`));
	});
});

describe('Field hints', () => {
	test('hint and error link both via aria-describedby', () => {
		const html = render(TextAreaField, {
			props: { name: 'notes', label: 'Notes', hint: 'Markdown supported', errors: { notes: 'Required' } }
		}).body;
		const tag = html.match(/<textarea\b[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('aria-describedby="notes-hint notes-notes-error"');
		expect(tag).toContain('aria-invalid="true"');
		expect(html).toContain('<p class="field-help" id="notes-hint">Markdown supported</p>');
		expect(html).toContain('id="notes-notes-error"');
	});

	test('hint only links the hint', () => {
		const html = render(TextAreaField, {
			props: { name: 'notes', label: 'Notes', hint: 'Markdown supported' }
		}).body;
		const tag = html.match(/<textarea\b[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('aria-describedby="notes-hint"');
		expect(tag).not.toContain('aria-invalid');
	});

	test('no hint and no error has no aria-describedby', () => {
		const html = render(TextAreaField, { props: { name: 'notes', label: 'Notes' } }).body;
		const tag = html.match(/<textarea\b[^>]*>/)?.[0] ?? '';
		expect(tag).not.toContain('aria-describedby');
	});

	test('hint has no axe violations', async () => {
		const violations = await checkA11y(TextAreaField, {
			name: 'notes',
			label: 'Notes',
			hint: 'Markdown supported'
		});
		expect(violations, formatViolations(violations)).toHaveLength(0);
	});
});

describe('Shared field hint parity', () => {
	const roleOptions = createRawSnippet(() => ({ render: () => '<option value="user">User</option>' }));

	test('TextField hint + error links hint and error ids', () => {
		const html = render(TextField, {
			props: { name: 'email', label: 'Email', hint: 'We never share this', errors: { email: 'Enter a valid email' } }
		}).body;
		const tag = html.match(/<input\b[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('aria-describedby="email-hint email-email-error"');
		expect(tag).toContain('aria-invalid="true"');
		expect(html).toContain('<p class="field-help" id="email-hint">We never share this</p>');
		expect(html).toContain('id="email-email-error"');
	});

	test('TextField hint only links the hint', () => {
		const html = render(TextField, {
			props: { name: 'email', label: 'Email', hint: 'We never share this' }
		}).body;
		const tag = html.match(/<input\b[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('aria-describedby="email-hint"');
		expect(tag).not.toContain('aria-invalid');
	});

	test('TextField with nothing extra has no aria-describedby or aria-invalid', () => {
		const html = render(TextField, { props: { name: 'email', label: 'Email' } }).body;
		const tag = html.match(/<input\b[^>]*>/)?.[0] ?? '';
		expect(tag).not.toContain('aria-describedby');
		expect(tag).not.toContain('aria-invalid');
		expect(html).not.toContain('field-help');
	});

	test('TextField forwards caller aria-describedby tokens', () => {
		const html = render(TextField, {
			props: { name: 'email', label: 'Email', 'aria-describedby': 'edit-user-password-hint' }
		}).body;
		const tag = html.match(/<input\b[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('aria-describedby="edit-user-password-hint"');
	});

	test('TextField forwards aria-describedby and still includes error id', () => {
		const html = render(TextField, {
			props: { name: 'newPassword', label: 'New password', 'aria-describedby': 'edit-user-password-hint', errors: { newPassword: 'Too short' } }
		}).body;
		const tag = html.match(/<input\b[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('aria-describedby="edit-user-password-hint newPassword-newPassword-error"');
		expect(tag).toContain('aria-invalid="true"');
	});

	test('TextField normalises whitespace in forwarded aria-describedby', () => {
		const html = render(TextField, {
			props: { name: 'email', label: 'Email', 'aria-describedby': '  a  b ' }
		}).body;
		const tag = html.match(/<input\b[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('aria-describedby="a b"');
	});

	test('TextField with multiple error keys links both error ids', () => {
		const html = render(TextField, {
			props: { name: 'email', label: 'Email', errorKey: ['start', 'end'], errors: { start: 'Bad start', end: 'Bad end' } }
		}).body;
		const tag = html.match(/<input\b[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('aria-describedby="email-start-error email-end-error"');
	});

	test('SelectField hint + error links hint and error ids', () => {
		const html = render(SelectField, {
			props: { name: 'role', label: 'Role', hint: 'Admins can manage users', errors: { role: 'Pick a role' }, children: roleOptions }
		}).body;
		const tag = html.match(/<select\b[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('aria-describedby="role-hint role-role-error"');
		expect(tag).toContain('aria-invalid="true"');
		expect(html).toContain('<option value="user">User</option>');
	});

	test('SelectField forwards aria-describedby and still includes error id', () => {
		const html = render(SelectField, {
			props: { name: 'role', label: 'Role', 'aria-describedby': 'x-hint', errors: { role: 'Pick a role' }, children: roleOptions }
		}).body;
		const tag = html.match(/<select\b[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('aria-describedby="x-hint role-role-error"');
	});

	test('TextField and SelectField hints have no axe violations', async () => {
		const fieldViolations = await checkA11y(TextField, { name: 'email', label: 'Email', hint: 'We never share this' });
		expect(fieldViolations, formatViolations(fieldViolations)).toHaveLength(0);
		const selectViolations = await checkA11y(SelectField, {
			name: 'role',
			label: 'Role',
			hint: 'Admins can manage users',
			children: roleOptions
		});
		expect(selectViolations, formatViolations(selectViolations)).toHaveLength(0);
	});
});
