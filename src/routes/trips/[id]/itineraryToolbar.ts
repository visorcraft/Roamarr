/** Glyph and accessible name for the itinerary sort toggle. `ascending` matches
 * the second argument of `groupSegmentsByDay` in `+page.svelte`. */
export function sortToggleState(ascending: boolean): { label: string; glyph: string } {
	return ascending
		? { label: 'Sort: earliest first', glyph: '↑↓' }
		: { label: 'Sort: latest first', glyph: '↓↑' };
}
