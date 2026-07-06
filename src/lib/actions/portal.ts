export function portal(node: HTMLElement, target: HTMLElement | string = 'body') {
	let targetEl: HTMLElement | null;
	function update(newTarget: HTMLElement | string) {
		target = newTarget;
		targetEl = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
		if (targetEl && node.parentElement !== targetEl) {
			targetEl.appendChild(node);
		}
		node.hidden = false;
	}
	update(target);
	return {
		update,
		destroy() {
			if (node.parentNode) node.parentNode.removeChild(node);
		}
	};
}
