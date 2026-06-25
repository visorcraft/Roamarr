export const VISIBILITY_BADGE: Record<string, string> = {
	private: 'badge-slate',
	groups: 'badge-brand',
	public: 'badge-green'
};

export function visibilityBadgeClass(visibility: string) {
	return VISIBILITY_BADGE[visibility] ?? 'badge-slate';
}
