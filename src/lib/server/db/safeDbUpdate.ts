/**
 * Wraps a DB write callback. If the callback throws an engine-level error
 * (InvalidArgument, NOT NULL violation, type mismatch), the error is caught
 * and re-thrown as a plain Error with a clean message — so the caller or
 * the global hooks handler can present it as a 400 instead of a 500.
 *
 * This does NOT attempt to repair the row (repair is handled at the read
 * level by getSettings / repo-level get functions). It only ensures the
 * error is catchable and user-friendly.
 */
export function safeDbUpdate<T>(fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		// Strip engine internals for a cleaner message
		const clean = msg
			.replace(/^InvalidArgument\(["']/, '')
			.replace(/["']\)$/, '')
			.replace(/^KitValidationError:\s*/, '');
		throw new Error(clean);
	}
}
