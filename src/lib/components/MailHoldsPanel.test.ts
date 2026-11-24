// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
import { m } from '$lib/paraglide/messages';
import MailHoldsPanel from './MailHoldsPanel.svelte';

// The component gates mount work on `$app/env` browser. Vitest loads the kit
// virtual module under the SSR transform, which makes `browser` false; force it
// true so the dialog open/close effect runs in this jsdom mount harness.
vi.mock('$app/env', () => ({ browser: true, dev: false, building: false, version: '0.0.0' }));

describe('MailHoldsPanel catalog', () => {
	const expectedMessages: Record<string, string> = {
		mail_holds_title: 'Mail holds',
		mail_holds_usps_link: 'USPS Hold Mail',
		mail_holds_uncovered_warning: 'Away dates are not fully covered.',
		mail_holds_coverage_unknown: 'Set the trip start and end to check which days a hold covers.',
		mail_holds_empty: 'No mail holds yet.',
		mail_holds_action_edit: 'Edit',
		mail_holds_action_next_30: 'Next 30 days',
		mail_holds_action_delete: 'Delete',
		mail_holds_action_save: 'Save hold',
		mail_holds_action_add: 'Add mail hold',
		mail_holds_carrier_label: 'Carrier',
		mail_holds_start_label: 'Start',
		mail_holds_end_label: 'End',
		mail_holds_status_label: 'Status',
		mail_holds_confirmation_label: 'Confirmation',
		mail_holds_address_label: 'Address label',
		mail_holds_notes_label: 'Notes',
		mail_holds_status_requested: 'Requested',
		mail_holds_status_active: 'Active',
		mail_holds_status_ended: 'Ended',
		mail_holds_status_cancelled: 'Cancelled',
		mail_holds_delete_confirm: 'Delete this mail hold?'
	};

	it.each(Object.entries(expectedMessages))(
		'catalog message %s matches the English string',
		(key, expected) => {
			const fn = (m as Record<string, (i?: unknown) => string>)[key];
			expect(typeof fn).toBe('function');
			expect(fn()).toBe(expected);
		}
	);

	it('mail_holds_date_range matches the English string', () => {
		expect(m.mail_holds_date_range({ start: '2026-12-01', end: '2026-12-10' })).toBe('2026-12-01 to 2026-12-10');
	});

	it('mail_holds_confirmation_value matches the English string', () => {
		expect(m.mail_holds_confirmation_value({ code: 'ABC123' })).toBe('Confirmation ABC123');
	});

	it('mail_holds_renewal_date matches the English string', () => {
		expect(m.mail_holds_renewal_date({ day: '2026-12-10' })).toBe('Renewal date 2026-12-10');
	});
});

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
			(button) => button.textContent?.trim() === m.mail_holds_action_delete()
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

	function findEditButton() {
		return Array.from(document.querySelectorAll('button')).find(
			(button) => button.textContent?.trim() === m.mail_holds_action_edit()
		)!;
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
		const editButton = findEditButton();
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
		expect(document.body.textContent).toContain(m.mail_holds_empty());
		expect(document.querySelector('dialog')).toBeFalsy();
	});

	it('uses shared field primitives with unique, labelled controls in the edit form', () => {
		mountPanel();
		findEditButton().click();
		flushSync();
		const form = document.querySelector('form[action="?/updateMailHold"]');
		expect(form).toBeTruthy();

		expect(form!.querySelector('#mail-carrier-7')?.tagName).toBe('INPUT');
		const start = form!.querySelector('#mail-start-7');
		const end = form!.querySelector('#mail-end-7');
		expect(start?.getAttribute('type')).toBe('date');
		expect(start?.hasAttribute('required')).toBe(true);
		expect(end?.getAttribute('type')).toBe('date');
		expect(end?.hasAttribute('required')).toBe(true);
		expect(form!.querySelector('#mail-status-7')?.tagName).toBe('SELECT');
		const notes = form!.querySelector('#mail-notes-7');
		expect(notes?.tagName).toBe('TEXTAREA');
		expect(notes?.getAttribute('maxlength')).toBe('2000');
		expect(form!.querySelector('#mail-confirm-7')?.tagName).toBe('INPUT');
		expect(form!.querySelector('#mail-address-7')?.tagName).toBe('INPUT');

		for (const id of ['mail-carrier-7', 'mail-start-7', 'mail-end-7', 'mail-status-7', 'mail-confirm-7', 'mail-address-7', 'mail-notes-7']) {
			const control = form!.querySelector(`#${id}`);
			expect(control).toBeTruthy();
			const field = control!.closest('.field');
			expect(field).toBeTruthy();
			const label = field!.querySelector('label.label');
			expect(label?.getAttribute('for')).toBe(id);
		}

		expect(form!.querySelectorAll('.field').length).toBe(7);

		const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('uses shared field primitives in the add form', () => {
		mountPanel();
		const form = document.querySelector('form[action="?/addMailHold"]');
		expect(form).toBeTruthy();

		const fields: Array<[string, string]> = [
			['mail-carrier-new', m.mail_holds_carrier_label()],
			['mail-start-new', m.mail_holds_start_label()],
			['mail-end-new', m.mail_holds_end_label()],
			['mail-status-new', m.mail_holds_status_label()],
			['mail-confirm-new', m.mail_holds_confirmation_label()],
			['mail-address-new', m.mail_holds_address_label()],
			['mail-notes-new', m.mail_holds_notes_label()]
		];
		for (const [id, labelText] of fields) {
			const control = form!.querySelector(`#${id}`);
			expect(control).toBeTruthy();
			const field = control!.closest('.field');
			expect(field).toBeTruthy();
			const label = field!.querySelector('label.label');
			expect(label?.getAttribute('for')).toBe(id);
			expect(label?.textContent?.trim()).toBe(labelText);
		}

		expect((form!.querySelector('#mail-status-new') as HTMLSelectElement).value).toBe('requested');
		expect((form!.querySelector('#mail-carrier-new') as HTMLInputElement).value).toBe('USPS');
		expect(form!.querySelectorAll('.field').length).toBe(7);
	});

	it('shows translated status labels instead of raw enum values', () => {
		mountPanel();
		const badge = document.querySelector('.badge');
		expect(badge?.textContent?.trim()).toBe('Active');
		expect(document.body.textContent).not.toMatch(/\b(requested|active|ended|cancelled)\b/);

		findEditButton().click();
		flushSync();
		const select = document.querySelector('form[action="?/updateMailHold"] #mail-status-7') as HTMLSelectElement;
		expect(select).toBeTruthy();
		const options = Array.from(select.querySelectorAll('option'));
		expect(options.map((option) => option.textContent?.trim())).toEqual(['Requested', 'Active', 'Ended', 'Cancelled']);
		expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual(['requested', 'active', 'ended', 'cancelled']);
	});

	it('shows confirmation and renewal details', () => {
		mountPanel({
			holds: [{ ...hold, confirmationNumber: 'ABC123' }]
		});
		expect(document.body.textContent).toContain('Confirmation ABC123');
		expect(document.body.textContent).toContain('Renewal date 2026-12-10');
		expect(document.body.textContent).toContain('2026-12-01 to 2026-12-10');
	});

	it('explains uncovered and unknown coverage', () => {
		const app = mountPanel({
			coverage: {
				awayDatesKnown: true,
				uncoveredRanges: [
					{ start: '2026-12-03', end: '2026-12-04' },
					{ start: '2026-12-07', end: '2026-12-07' }
				],
				warnings: []
			}
		});
		expect(document.body.textContent).toContain('Away dates are not fully covered.');
		expect(document.body.textContent).toContain('2026-12-03 to 2026-12-04');
		expect(document.body.textContent).toContain('2026-12-07');

		unmount(app);
		mounted.splice(mounted.indexOf(app), 1);
		document.body.innerHTML = '';

		mountPanel({
			coverage: { awayDatesKnown: false, uncoveredRanges: [], warnings: [] }
		});
		expect(document.body.textContent).toContain('Set the trip start and end to check which days a hold covers.');
	});

	it('offers the renewal action only for non-cancelled holds', () => {
		const app = mountPanel();
		const nextForm = document.querySelector('form[action="?/addNextMailHold"]');
		expect(nextForm).toBeTruthy();
		expect(nextForm!.querySelector('input[name="holdId"]')?.getAttribute('value')).toBe('7');
		expect(nextForm!.querySelector('button')?.textContent?.trim()).toBe(m.mail_holds_action_next_30());

		unmount(app);
		mounted.splice(mounted.indexOf(app), 1);
		document.body.innerHTML = '';

		mountPanel({
			holds: [{ ...hold, status: 'cancelled' }]
		});
		expect(document.querySelector('form[action="?/addNextMailHold"]')).toBeFalsy();
	});

	it('links to USPS Hold Mail', () => {
		mountPanel();
		const link = document.querySelector('a[href="https://holdmail.usps.com/holdmail/"]');
		expect(link).toBeTruthy();
		expect(link!.textContent?.trim()).toBe('USPS Hold Mail');
		expect(link!.getAttribute('target')).toBe('_blank');
		expect(link!.getAttribute('rel')).toContain('noreferrer');
	});
});
