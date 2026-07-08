<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { onDestroy } from 'svelte';
	import ProfileTabs from '$lib/components/ProfileTabs.svelte';

	let { data, form } = $props();
	let selectedThemeId = $state<string | null>(null);
	let submitting = $state(false);

	function applyThemePreview(themeId: string) {
		if (!browser) return;
		document.querySelector<HTMLElement>('.theme-root')?.setAttribute('data-theme', themeId);
		const theme = data.themes.find((candidate) => candidate.id === themeId);
		if (theme)
			document
				.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
				?.setAttribute('content', theme.themeColor);
	}

	const activeThemeId = $derived(selectedThemeId ?? data.themeId);

	$effect(() => {
		applyThemePreview(activeThemeId);
	});

	onDestroy(() => applyThemePreview(data.themeId));

	const selectedThemeName = $derived(
		data.themes.find((theme) => theme.id === activeThemeId)?.name ?? 'Midnight Travels'
	);
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Theme</h1>
		<p class="page-subtitle">Pick a look for the app. Changes preview live.</p>
	</div>
</header>

<ProfileTabs />

{#if form?.error}<p class="notice notice-error mt-6">{form.error}</p>{/if}

<section class="card mt-6 p-5 sm:p-6">
	<form
		method="POST"
		action="?/updateTheme"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
		class="grid gap-4 sm:grid-cols-2"
	>
		<div class="field sm:col-span-2">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<span id="theme-label" class="label">Theme</span>
				<span class="badge badge-brand">{selectedThemeName}</span>
			</div>
			<div class="theme-option-grid" role="radiogroup" aria-labelledby="theme-label">
				{#each data.themes as theme (theme.id)}
					<label class="theme-option">
						<input
							type="radio"
							name="themeId"
							value={theme.id}
							checked={activeThemeId === theme.id}
							onchange={() => (selectedThemeId = theme.id)}
						/>
						<span class="theme-option-preview theme-preview" data-theme={theme.id} aria-hidden="true">
							<span class="theme-option-sidebar"></span>
							<span class="theme-option-surface">
								<span class="theme-option-line"></span>
								<span class="theme-option-line theme-option-line-muted"></span>
								<span class="theme-option-accent"></span>
							</span>
						</span>
						<span class="min-w-0 flex-1">
							<span class="theme-option-name block font-semibold">{theme.name}</span>
							<span class="theme-option-description mt-1 block text-xs">{theme.description}</span>
						</span>
					</label>
				{/each}
			</div>
		</div>
		<div class="flex justify-end sm:col-span-2">
			<button class="btn btn-primary" class:btn-loading={submitting} disabled={submitting}>
				Save theme
			</button>
		</div>
	</form>
</section>
