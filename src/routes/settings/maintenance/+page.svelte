<script lang="ts">
	type MaintenanceAction = 'check' | 'gc' | 'flush' | 'doctor';
	type Operation = {
		action: MaintenanceAction;
		title: string;
		description: string;
		badge: string;
		badgeClass: string;
		buttonClass: string;
		runLabel: string;
		confirmLabel?: string;
	};

	let { form }: {
		form?: {
			action?: MaintenanceAction;
			success?: boolean;
			result?: unknown;
			error?: string;
		};
	} = $props();

	const operations: Operation[] = [
		{
			action: 'check',
			title: 'Check integrity',
			description: 'Read-only scan of run footer checksums.',
			badge: 'Safe',
			badgeClass: 'badge-green',
			buttonClass: 'btn btn-primary',
			runLabel: 'Run check'
		},
		{
			action: 'gc',
			title: 'Garbage collect',
			description: 'Compact sorted runs and reclaim obsolete run data.',
			badge: 'Operational',
			badgeClass: 'badge-amber',
			buttonClass: 'btn btn-primary',
			runLabel: 'Run garbage collection',
			confirmLabel: 'Yes, run garbage collection on the live database'
		},
		{
			action: 'flush',
			title: 'Flush memtables',
			description: 'Force in-memory writes to durable sorted runs.',
			badge: 'Operational',
			badgeClass: 'badge-amber',
			buttonClass: 'btn btn-primary',
			runLabel: 'Flush memtables',
			confirmLabel: 'Yes, flush memtables now'
		},
		{
			action: 'doctor',
			title: 'Doctor',
			description: 'Drop or quarantine corrupt runs. Only run this after confirming a recent backup.',
			badge: 'Destructive',
			badgeClass: 'badge-red',
			buttonClass: 'btn btn-danger',
			runLabel: 'Run doctor',
			confirmLabel: 'Yes, doctor may drop or quarantine corrupt runs'
		}
	];
</script>

<header>
	<h1 class="page-title">Maintenance</h1>
	<p class="page-subtitle">Run integrity checks and operational tasks on the database.</p>
</header>

<section class="mt-6 grid gap-4 sm:grid-cols-2">
	{#each operations as op (op.action)}
		<form method="POST" action="?/{op.action}" class="card p-5">
			<div class="flex items-start justify-between gap-3">
				<h2 class="section-title">{op.title}</h2>
				<span class="badge {op.badgeClass}">{op.badge}</span>
			</div>
			<p class="field-help mt-2">{op.description}</p>
			{#if op.confirmLabel}
				<label class="checkbox-label mt-4 block">
					<input type="checkbox" name="confirmMaintenance" value={op.action} class="checkbox" />
					{op.confirmLabel}
				</label>
			{/if}
			<div class="mt-4">
				<button type="submit" class="{op.buttonClass} w-full sm:w-auto">{op.runLabel}</button>
			</div>
		</form>
	{/each}
</section>

{#if form?.action}
	<section class="card mt-6 p-5 sm:p-6" aria-live="polite">
		<h2 class="section-title">Result</h2>
		{#if form.success}
			<p class="notice notice-success mt-2">{form.action} completed successfully.</p>
			<code class="code-chip mt-2 block whitespace-pre-wrap">{JSON.stringify(form.result, null, 2)}</code>
		{:else}
			<p class="notice notice-error mt-2">{form.error}</p>
		{/if}
	</section>
{/if}
