<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	let { password }: { password: string } = $props();

	function score(pw: string): number {
		let points = 0;
		if (pw.length >= 8) points++;
		if (pw.length >= 12) points++;
		if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) points++;
		if (/[0-9]/.test(pw)) points++;
		if (/[^A-Za-z0-9]/.test(pw)) points++;
		return Math.min(4, Math.floor(points / 1.25));
	}

	const labels = [
		m.password_strength_very_weak,
		m.password_strength_weak,
		m.password_strength_fair,
		m.password_strength_strong,
		m.password_strength_very_strong
	];
	const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-emerald-500', 'bg-green-500'];

	const s = $derived(score(password));
	const tone = $derived(
		s >= 3
			? 'text-[var(--theme-readable-success)]'
			: s === 2
				? 'text-[var(--theme-readable-warning)]'
				: 'text-[var(--theme-readable-danger)]'
	);
</script>

{#if password}
	<div class="mt-2">
		<div
			role="meter"
			aria-label={m.password_strength_label()}
			aria-valuemin="0"
			aria-valuemax="4"
			aria-valuenow={s}
			aria-valuetext={labels[s]()}
			class="flex h-1.5 overflow-hidden rounded-full bg-[var(--theme-line)]"
		>
			{#each Array(4) as _, i}
				<div class="flex-1 border-r border-surface last:border-r-0">
					<div class="h-full w-full {i < s ? colors[s] : 'bg-transparent'}"></div>
				</div>
			{/each}
		</div>
		<p aria-live="polite" class="mt-1 text-xs {tone}">{labels[s]()}</p>
	</div>
{/if}
