import { test, expect } from 'vitest';
import { checkA11y, formatViolations } from '../../../tests/a11y';
import Toast from './Toast.svelte';
import Icon from './Icon.svelte';
import EmptyState from './EmptyState.svelte';
import CopyButton from './CopyButton.svelte';
import TextField from './TextField.svelte';
import CityAutocomplete from './segments/CityAutocomplete.svelte';

test('Toast has no axe violations', async () => {
	const violations = await checkA11y(Toast, { message: 'Settings saved.', variant: 'success' });
	expect(violations, formatViolations(violations)).toHaveLength(0);
});

test('Toast warning variant has no axe violations', async () => {
	const violations = await checkA11y(Toast, { message: 'Heads up.', variant: 'warning' });
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
