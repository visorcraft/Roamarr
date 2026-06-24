/**
 * Copy text to the system clipboard.
 * Returns true on success, false otherwise (e.g. denied permission, missing API).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
