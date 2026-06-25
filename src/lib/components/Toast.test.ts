import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import Toast from './Toast.svelte';

test('renders the flash message', () => {
	const { body } = render(Toast, { props: { message: 'Settings saved.' } });
	expect(body).toContain('Settings saved.');
	expect(body).toContain('role="status"');
	expect(body).toContain('aria-live="polite"');
});

test('renders nothing when no message is provided', () => {
	const { body } = render(Toast, { props: { message: '' } });
	expect(body).not.toContain('role="status"');
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
