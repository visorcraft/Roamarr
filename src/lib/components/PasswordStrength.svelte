<script lang="ts">
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

	const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
	const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-emerald-500', 'bg-green-500'];

	const s = $derived(score(password));
</script>

{#if password}
	<div class="mt-2">
		<div class="flex h-1.5 overflow-hidden rounded-full bg-white/10">
			{#each Array(4) as _, i}
				<div class="flex-1 border-r border-surface last:border-r-0">
					<div class="h-full w-full {i < s ? colors[s] : 'bg-transparent'}"></div>
				</div>
			{/each}
		</div>
		<p class="mt-1 text-xs {s >= 3 ? 'text-emerald-300' : s >= 2 ? 'text-yellow-300' : 'text-red-300'}">{labels[s]}</p>
	</div>
{/if}
