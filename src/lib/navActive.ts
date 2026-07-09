export type NavChild = { href: string; label: string };
export type NavItem = { href: string; label: string; children?: NavChild[] };

export function isActive(path: string, href: string): boolean {
	return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
}

export function activeChildHref(path: string, children: NavChild[]): string | null {
	let match: string | null = null;
	for (const child of children) {
		if (path === child.href || path.startsWith(child.href + '/')) {
			if (!match || child.href.length > match.length) {
				match = child.href;
			}
		}
	}
	return match;
}

export function activeItemHref(path: string, items: NavItem[]): string | null {
	let match: string | null = null;
	for (const item of items) {
		if (isActive(path, item.href) || (item.children && activeChildHref(path, item.children))) {
			if (!match || item.href.length > match.length) {
				match = item.href;
			}
		}
	}
	return match;
}
