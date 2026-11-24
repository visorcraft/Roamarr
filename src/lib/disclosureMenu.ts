const MENU_SELECTOR = 'details.app-user-menu';

function openMenusOutside(root: ParentNode, target: Node): HTMLDetailsElement[] {
	return Array.from(root.querySelectorAll<HTMLDetailsElement>(`${MENU_SELECTOR}[open]`)).filter(
		(menu) => !menu.contains(target)
	);
}

export function installDisclosureMenus(root?: Document | HTMLElement): () => void {
	const target = root ?? (typeof document !== 'undefined' ? document : null);
	if (!target) return () => {};
	const onKeydown = (event: Event) => {
		if ((event as KeyboardEvent).key !== 'Escape') return;
		const el = event.target as Element | null;
		const menu = el && typeof el.closest === 'function' ? el.closest<HTMLDetailsElement>(MENU_SELECTOR) : null;
		if (!menu || !menu.open) return;
		event.preventDefault();
		event.stopPropagation();
		menu.open = false;
		menu.querySelector('summary')?.focus();
	};
	const onFocusout = (event: Event) => {
		const next = (event as FocusEvent).relatedTarget;
		if (!next) return;
		for (const menu of openMenusOutside(target, next as Node)) menu.open = false;
	};
	const onClick = (event: Event) => {
		const el = event.target as Node | null;
		if (el) for (const menu of openMenusOutside(target, el)) menu.open = false;
	};
	target.addEventListener('keydown', onKeydown);
	target.addEventListener('focusout', onFocusout);
	target.addEventListener('click', onClick);
	return () => {
		target.removeEventListener('keydown', onKeydown);
		target.removeEventListener('focusout', onFocusout);
		target.removeEventListener('click', onClick);
	};
}
