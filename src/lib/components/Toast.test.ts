import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import Toast from './Toast.svelte';

test('renders the flash message', () => {
	const { body } = render(Toast, { props: { message: 'Settings saved.' } });
	expect(body).toContain('Settings saved.');
	expect(body).toContain('role="status"');
});

test('renders nothing when no message is provided', () => {
	const { body } = render(Toast, { props: { message: '' } });
	expect(body).not.toContain('role="status"');
});
