<script lang="ts">
	import CopyButton from '$lib/components/CopyButton.svelte';

	let { data } = $props();

	let filterText = $state('');
	let wrapText = $state(false);
	let previousTab = $state('');

	$effect(() => {
		if (previousTab !== data.activeTab) {
			filterText = '';
			previousTab = data.activeTab;
		}
	});

	const query = $derived(filterText.trim().toLowerCase());
	const matchingLines = $derived.by(() => {
		if (!query) return [];
		return data.currentDocument.body
			.split('\n')
			.map((line: string, index: number) => ({ line, index }))
			.filter(({ line }) => line.toLowerCase().includes(query));
	});
	const visibleBody = $derived.by(() => {
		if (!query) return data.currentDocument.body;
		if (!matchingLines.length) return `No matches for "${filterText}".`;
		return matchingLines.map(({ line, index }) => `${String(index + 1).padStart(5, ' ')}  ${line}`).join('\n');
	});
	const resultLabel = $derived(
		query ? `${matchingLines.length} matching lines` : `${data.currentDocument.lineCount} lines`
	);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Licenses</h1>
		<p class="page-subtitle">Bundled license and attribution documents for Roamarr.</p>
	</div>
	<a class="btn btn-secondary" href="/settings/about/credits">Credits</a>
</header>

<nav class="tab-list mt-6" aria-label="License documents">
	{#each data.tabs as tab (tab.id)}
		<a
			href={tab.href}
			aria-current={tab.id === data.activeTab ? 'page' : undefined}
			class="tab-link {tab.id === data.activeTab ? 'tab-link-active' : ''}"
		>
			{tab.title}
		</a>
	{/each}
</nav>

<section class="card mt-6 p-5 sm:p-6">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h2 class="section-title">{data.currentDocument.title}</h2>
			<p class="page-subtitle">{data.currentDocument.subtitle}</p>
		</div>
		<div class="flex items-center gap-2">
			<span class="code-chip">{resultLabel}</span>
			<CopyButton
				text={data.currentDocument.body}
				label="Copy"
				copiedLabel="Copied"
				icon="copy"
				class="btn btn-ghost"
			/>
		</div>
	</div>

	<div class="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
		<input
			class="input lg:flex-1"
			name="license-filter"
			type="search"
			placeholder="Find by package, license, component, or phrase..."
			bind:value={filterText}
		/>
		<label class="check-toggle">
			<input class="checkbox" type="checkbox" bind:checked={wrapText} />
			<span class="check-label">Wrap</span>
		</label>
		<button
			class="btn btn-ghost"
			type="button"
			disabled={!filterText}
			onclick={() => {
				filterText = '';
			}}
		>
			Clear
		</button>
	</div>

	<pre
		class:whitespace-pre={!wrapText}
		class:whitespace-pre-wrap={wrapText}
		class:break-words={wrapText}
		class="mt-4 max-h-[70vh] min-h-[26rem] overflow-auto rounded-lg p-4 font-mono text-xs leading-relaxed ring-1"
	><code>{visibleBody}</code></pre>
</section>
