// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
import ConfirmModal from './ConfirmModal.svelte';

describe('ConfirmModal', () => {
	const mounted: unknown[] = [];

	afterEach(() => {
		for (const app of mounted) {
			unmount(app);
		}
		mounted.length = 0;
		document.body.innerHTML = '';
	});

	function mountModal(props: Record<string, unknown>) {
		const app = mount(ConfirmModal, { target: document.body, props });
		flushSync();
		mounted.push(app);
		return app;
	}

	it('renders the title and message when open=true', () => {
		mountModal({
			open: true,
			title: 'Delete?',
			message: 'Are you sure?',
			onconfirm: vi.fn(),
			oncancel: vi.fn()
		});
		expect(document.body.textContent).toContain('Delete?');
		expect(document.body.textContent).toContain('Are you sure?');
	});

	it('renders nothing when open=false', () => {
		mountModal({
			open: false,
			title: 'Delete?',
			message: 'Are you sure?',
			onconfirm: vi.fn(),
			oncancel: vi.fn()
		});
		expect(document.body.textContent).not.toContain('Delete?');
		expect(document.body.textContent).not.toContain('Are you sure?');
		expect(document.body.textContent).not.toContain('Confirm');
		expect(document.body.textContent).not.toContain('Cancel');
	});

	it('renders the confirm and cancel button labels', () => {
		mountModal({
			open: true,
			title: 'Archive?',
			message: 'Archive this item?',
			confirmLabel: 'Archive',
			cancelLabel: 'Go back',
			onconfirm: vi.fn(),
			oncancel: vi.fn()
		});
		expect(document.body.textContent).toContain('Archive');
		expect(document.body.textContent).toContain('Go back');
	});

	it('calls onconfirm when the confirm button is clicked', () => {
		const onconfirm = vi.fn();
		const oncancel = vi.fn();
		mountModal({
			open: true,
			title: 'Delete?',
			message: 'Are you sure?',
			onconfirm,
			oncancel
		});
		const confirmButton = Array.from(document.querySelectorAll('button')).find(
			(b) => b.textContent?.trim() === 'Confirm'
		);
		expect(confirmButton).toBeTruthy();
		confirmButton!.click();
		expect(onconfirm).toHaveBeenCalledOnce();
		expect(oncancel).not.toHaveBeenCalled();
	});

	it('calls oncancel when the cancel button is clicked', () => {
		const onconfirm = vi.fn();
		const oncancel = vi.fn();
		mountModal({
			open: true,
			title: 'Delete?',
			message: 'Are you sure?',
			onconfirm,
			oncancel
		});
		const cancelButton = Array.from(document.querySelectorAll('button')).find(
			(b) => b.textContent?.trim() === 'Cancel'
		);
		expect(cancelButton).toBeTruthy();
		cancelButton!.click();
		expect(oncancel).toHaveBeenCalledOnce();
		expect(onconfirm).not.toHaveBeenCalled();
	});
});
