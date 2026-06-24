const PICKER_TYPES = new Set(['date', 'datetime-local', 'time']);

export function installPickerInputs(root: Document | HTMLElement = document) {
	const handler = (event: Event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) return;
		if (!PICKER_TYPES.has(target.type)) return;
		if (target.disabled || target.readOnly) return;
		if (typeof target.showPicker !== 'function') return;
		try {
			target.showPicker();
		} catch {
			// picker already open or browser rejected the gesture
		}
	};

	root.addEventListener('click', handler);
	return () => root.removeEventListener('click', handler);
}
