/**
 * Copy text to the system clipboard.
 * Returns true on success, false otherwise (e.g. denied permission, missing API).
 */
export type CopyStatus = 'idle' | 'copied' | 'failed';

export function createCopyFeedback(onChange: (status: CopyStatus) => void, durationMs = 2000) {
	let timer: ReturnType<typeof setTimeout> | null = null;

	function clearPending() {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	}

	return {
		report(ok: boolean) {
			clearPending();
			onChange(ok ? 'copied' : 'failed');
			timer = setTimeout(() => {
				timer = null;
				onChange('idle');
			}, durationMs);
		},
		dispose() {
			clearPending();
		}
	};
}

async function legacyCopy(text: string): Promise<boolean> {
	const doc = typeof document !== 'undefined' ? document : undefined;
	if (!doc || !doc.body) return false;

	const previousActive = doc.activeElement as { focus?: () => void } | null;
	let textarea: HTMLTextAreaElement | null = null;

	try {
		textarea = doc.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'fixed';
		textarea.style.top = '0';
		textarea.style.left = '0';
		textarea.style.opacity = '0';
		doc.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		textarea.setSelectionRange(0, text.length);
		return doc.execCommand('copy');
	} catch {
		return false;
	} finally {
		if (textarea) textarea.remove();
		previousActive?.focus?.();
	}
}

export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		const writeText =
			typeof navigator !== 'undefined' ? navigator.clipboard?.writeText : undefined;
		if (writeText) {
			await writeText.call(navigator.clipboard, text);
			return true;
		}
	} catch {
		// fall through to the legacy copy
	}

	return await legacyCopy(text);
}
