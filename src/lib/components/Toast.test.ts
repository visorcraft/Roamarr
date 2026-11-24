import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import Toast from './Toast.svelte';

test('renders the flash message', () => {
	const { body } = render(Toast, { props: { message: 'Settings saved.' } });
	expect(body).toContain('Settings saved.');
	expect(body).toContain('role="status"');
	expect(body).toContain('aria-live="polite"');
});

test('keeps an empty live region mounted when no message is provided', () => {
	const { body } = render(Toast, { props: { message: '' } });
	// Svelte SSR puts {#if}-block anchor comments between the wrapper and its content.
	expect(body).toMatch(/<div role="status" aria-live="polite">(?:<!--[^>]*-->)*<\/div>/);
	expect(body).not.toContain('class="toast');
	expect(body).not.toContain('aria-label="Dismiss"');
});

test('uses an assertive alert region for the error variant', () => {
	const { body } = render(Toast, { props: { message: 'Could not save.', variant: 'error' } });
	expect(body).toContain('role="alert"');
	expect(body).toContain('aria-live="assertive"');
	expect(body).toContain('Could not save.');
	expect(body).not.toContain('role="status"');
	expect(body).not.toContain('aria-live="polite"');
});

test('uses a polite status region for non-error variants', () => {
	for (const variant of ['success', 'info', 'warning'] as const) {
		const { body } = render(Toast, { props: { message: 'Note.', variant } });
		expect(body).toContain('role="status"');
		expect(body).toContain('aria-live="polite"');
		expect(body).not.toContain('role="alert"');
		expect(body).not.toContain('aria-live="assertive"');
	}
});

test('renders the message inside the live region', () => {
	const { body } = render(Toast, { props: { message: 'Settings saved.' } });
	// Svelte SSR puts {#if}-block anchor comments between the wrapper and its content.
	expect(body).toMatch(/<div role="status" aria-live="polite">(?:\s|<!--[^>]*-->)*<div class="toast toast-success"/);
	expect(body.indexOf('role="status"')).toBeLessThan(body.indexOf('Settings saved.'));
});

test('renders a dismiss button by default', () => {
	const { body } = render(Toast, { props: { message: 'Saved.' } });
	expect(body).toContain('aria-label="Dismiss"');
});

test('hides the dismiss button when dismissible is false', () => {
	const { body } = render(Toast, { props: { message: 'Saved.', dismissible: false } });
	expect(body).not.toContain('aria-label="Dismiss"');
});

test('renders each variant with its icon and classes', () => {
	const variants = [
		{ variant: 'success', marker: 'toast-icon-success' },
		{ variant: 'error', marker: 'toast-icon-error' },
		{ variant: 'info', marker: 'toast-icon-info' },
		{ variant: 'warning', marker: 'toast-icon-warning' }
	] as const;

	for (const { variant, marker } of variants) {
		const { body } = render(Toast, { props: { message: `${variant} message`, variant } });
		expect(body).toContain(`${variant} message`);
		expect(body).toContain(`toast-${variant}`);
		expect(body).toContain(marker);
	}
});
