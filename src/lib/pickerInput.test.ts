// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { installPickerInputs } from './pickerInput';

function dateInput() {
	const input = document.createElement('input');
	input.type = 'date';
	document.body.appendChild(input);
	return input;
}

describe('installPickerInputs', () => {
	it('adds a document click listener and removes the same handler via the disposer', () => {
		const add = vi.spyOn(document, 'addEventListener');
		const remove = vi.spyOn(document, 'removeEventListener');

		const dispose = installPickerInputs();
		expect(add).toHaveBeenCalledWith('click', expect.any(Function));

		dispose();
		expect(remove).toHaveBeenCalledWith('click', expect.any(Function));
		expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]);

		add.mockRestore();
		remove.mockRestore();
	});

	it('opens the picker for an enabled date input, and stops after dispose', () => {
		const dispose = installPickerInputs();
		const input = dateInput();
		const showPicker = vi.fn();
		(input as unknown as { showPicker: () => void }).showPicker = showPicker;

		input.click();
		expect(showPicker).toHaveBeenCalledOnce();

		dispose();
		showPicker.mockClear();
		input.click();
		expect(showPicker).not.toHaveBeenCalled();

		input.remove();
	});

	it('ignores non-date and disabled inputs', () => {
		const dispose = installPickerInputs();
		const text = document.createElement('input');
		text.type = 'text';
		const textPicker = vi.fn();
		(text as unknown as { showPicker: () => void }).showPicker = textPicker;
		document.body.appendChild(text);

		const disabled = dateInput();
		disabled.disabled = true;
		const disabledPicker = vi.fn();
		(disabled as unknown as { showPicker: () => void }).showPicker = disabledPicker;

		text.click();
		disabled.click();
		expect(textPicker).not.toHaveBeenCalled();
		expect(disabledPicker).not.toHaveBeenCalled();

		dispose();
		text.remove();
		disabled.remove();
	});
});
