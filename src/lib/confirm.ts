/**
 * Returns a click handler that asks the user to confirm before allowing the
 * default action (for example, a form submission). If the user cancels,
 * `event.preventDefault()` is called.
 */
export function confirmHandler(message: string) {
	return (event: Event) => {
		if (!confirm(message)) {
			event.preventDefault();
		}
	};
}
