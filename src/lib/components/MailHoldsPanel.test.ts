// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
import MailHoldsPanel from './MailHoldsPanel.svelte';

// The component gates mount work on `$app/env` browser. Vitest loads the kit
// virtual module under the SSR transform, which makes `browser` false; force it
// true so the dialog open/close effect runs in this jsdom mount harness.
vi.mock('$app/env', () => ({ browser: true, dev: false, building: false, version: '0.0.0' }));

describe('MailHoldsPanel', () => {
	const mounted: unknown[] = [];

	const hold = {
		id: 7,
		carrier: 'USPS',
		startDate: '2026-12-01',
		endDate: '2026-12-10',
		confirmationNumber: null,
		addressLabel: null,
		notes: null,
		status: 'active' as const
	};

	const coverage = {
		awayDatesKnown: true,
		uncoveredRanges: [],
		warnings: []
	};

	beforeEach(() => {
		Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
			configurable: true,
			writable: true,
			value: function (this: HTMLDialogElement) {
				this.setAttribute('open', '');
			}
		});
		Object.defineProperty(HTMLDialogElement.prototype, 'close', {
			configurable: true,
			writable: true,
			value: function (this: HTMLDialogElement) {
				if (this.hasAttribute('open')) {
					this.removeAttribute('open');
					this.dispatchEvent(new Event('close'));
				}
			}
		});
	});

	afterEach(() => {
		for (const app of mounted) {
			unmount(app);
		}
		mounted.length = 0;
		document.body.innerHTML = '';
		vi.restoreAllMocks();
	});

	function mountPanel(overrides: Record<string, unknown> = {}) {
		const app = mount(MailHoldsPanel, {
			target: document.body,
			props: {
				holds: [hold],
				coverage,
				...overrides
			}
		});
		flushSync();
		mounted.push(app);
		return app;
	}

	function deleteTrigger() {
		const trigger = Array.from(document.querySelectorAll('button')).find(
			(button) => button.textContent?.trim() === 'Delete'
		);
		expect(trigger).toBeTruthy();
		return trigger!;
	}

	function openDialog() {
		deleteTrigger().click();
		flushSync();
		const dialog = document.querySelector('dialog');
		expect(dialog).toBeTruthy();
		return dialog!;
	}

	it('does not use the native confirm dialog', () => {
		const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
		mountPanel();
		deleteTrigger().click();
		flushSync();
		expect(confirmSpy).not.toHaveBeenCalled();
	});

	it('opens the dialog with an accessible name and a button trigger', () => {
		mountPanel();
		const dialog = openDialog();
		expect(dialog.hasAttribute('open')).toBe(true);
		const labelledby = dialog.getAttribute('aria-labelledby');
		expect(labelledby).toBeTruthy();
		const heading = document.getElementById(labelledby!);
		expect(heading?.tagName).toBe('H2');
		expect(heading?.textContent?.trim()).toBe('Are you sure?');
		expect(dialog.textContent).toContain('Delete this mail hold?');
		expect(deleteTrigger().getAttribute('type')).toBe('button');
	});

	it('closes on Cancel and runs onclose', () => {
		mountPanel();
		const dialog = openDialog();
		const closeSpy = vi.fn();
		dialog.addEventListener('close', closeSpy);
		const cancelButton = Array.from(dialog.querySelectorAll('button')).find(
			(button) => button.textContent?.trim() === 'Cancel'
		);
		expect(cancelButton).toBeTruthy();
		cancelButton!.click();
		flushSync();
		expect(dialog.hasAttribute('open')).toBe(false);
		expect(closeSpy).toHaveBeenCalledTimes(1);
	});

	it('closes on the Escape path', () => {
		mountPanel();
		const dialog = openDialog();
		expect(dialog.hasAttribute('open')).toBe(true);
		dialog.close();
		flushSync();
		expect(dialog.hasAttribute('open')).toBe(false);
	});

	it('submits the delete form from the Confirm button', () => {
		mountPanel();
		const dialog = openDialog();
		const confirmButton = Array.from(dialog.querySelectorAll('button')).find((button) => button.classList.contains('btn-danger'));
		expect(confirmButton).toBeTruthy();
		expect(confirmButton!.getAttribute('type')).toBe('submit');
		const deleteForm = confirmButton!.closest('form[action="?/deleteMailHold"]');
		expect(deleteForm).toBeTruthy();
		confirmButton!.click();
		flushSync();
		const submitEvent = new Event('submit', { cancelable: true });
		deleteForm!.dispatchEvent(submitEvent);
		expect(submitEvent.defaultPrevented).toBe(false);
	});

	it('toggles the Edit disclosure with aria-expanded', () => {
		mountPanel();
		const editButton = Array.from(document.querySelectorAll('button')).find(
			(button) => button.textContent?.trim() === 'Edit'
		)!;
		expect(editButton.getAttribute('aria-expanded')).toBe('false');
		editButton.click();
		flushSync();
		expect(editButton.getAttribute('aria-expanded')).toBe('true');
		expect(document.querySelector('form[action="?/updateMailHold"]')).toBeTruthy();
		editButton.click();
		flushSync();
		expect(editButton.getAttribute('aria-expanded')).toBe('false');
		expect(document.querySelector('form[action="?/updateMailHold"]')).toBeFalsy();
	});

	it('renders the empty state without a dialog', () => {
		mountPanel({
			holds: [],
			coverage: { awayDatesKnown: false, uncoveredRanges: [], warnings: [] }
		});
		expect(document.body.textContent).toContain('No mail holds yet.');
		expect(document.querySelector('dialog')).toBeFalsy();
	});
});
