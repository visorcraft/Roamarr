<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Toast from '$lib/components/Toast.svelte';
	import { installPickerInputs } from '$lib/pickerInput';

	let { data, children } = $props();
	let open = $state(false);

	onMount(() => installPickerInputs());

	const NAV = [
		{ href: '/', label: 'Dashboard', icon: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>' },
		{ href: '/trips', label: 'Trips', icon: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>' },
		{ href: '/profile/documents', label: 'Documents', icon: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>' },
		{ href: '/profile/loyalty', label: 'Loyalty', icon: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>' },
		{ href: '/cards', label: 'Cards', icon: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>' },
		{ href: '/insurance', label: 'Insurance', icon: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>' },
		{ href: '/groups', label: 'Groups', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
		{ href: '/notifications', label: 'Notifications', icon: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>' }
	];
	const SETTINGS = { href: '/settings', label: 'Settings', icon: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>' };

	const path = $derived(page.url.pathname);
	const standalone = $derived(!data.user || /^\/(login|setup|register|share)(\/|$)/.test(path));
	const navItems = $derived(data.user?.role === 'admin' ? [...NAV, SETTINGS] : NAV);
	const initials = $derived(
		(data.user?.displayName ?? '?')
			.split(/\s+/)
			.map((s) => s[0])
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
	const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
</script>

{#snippet brand(size: 'sm' | 'lg')}
	<a href="/" class="flex items-center gap-2.5">
		<span
			class="grid place-items-center rounded-xl bg-gradient-to-br from-indigo-400 via-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-900/40 {size ===
			'lg'
				? 'h-9 w-9'
				: 'h-8 w-8'}"
		>
			<svg viewBox="0 0 24 24" fill="currentColor" class="h-4.5 w-4.5 text-white" aria-hidden="true">
				<polygon points="3 11 22 2 13 21 11 13 3 11" />
			</svg>
		</span>
		<span class="font-display text-lg font-extrabold tracking-tight text-white">
			{data.instanceName ?? 'Roamarr'}
		</span>
	</a>
{/snippet}

{#key data.flash}
	<Toast message={data.flash ?? ''} />
{/key}

{#if standalone}
	<div class="flex min-h-screen flex-col">
		<header class="flex items-center px-5 py-4 sm:px-8">
			{@render brand('lg')}
		</header>
		<main class="grid flex-1 place-items-center px-4 py-8">
			{@render children()}
		</main>
	</div>
{:else}
	<div class="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
		<!-- Backdrop (mobile) -->
		{#if open}
			<button
				class="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
				aria-label="Close menu"
				onclick={() => (open = false)}
			></button>
		{/if}

		<!-- Sidebar -->
		<aside
			class="fixed inset-y-0 left-0 z-40 flex h-dvh w-64 flex-col border-r border-white/10 bg-surface/80 backdrop-blur-xl transition-transform duration-200 lg:sticky lg:top-0 lg:translate-x-0 {open
				? 'translate-x-0'
				: '-translate-x-full'}"
		>
			<div class="flex h-16 items-center px-5">
				{@render brand('lg')}
			</div>

			<nav class="flex-1 space-y-1 overflow-y-auto px-3 py-2">
				{#each navItems as item (item.href)}
					<a
						href={item.href}
						onclick={() => (open = false)}
						aria-current={isActive(item.href) ? 'page' : undefined}
						class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition {isActive(
							item.href
						)
							? 'bg-indigo-500/15 text-white ring-1 ring-inset ring-indigo-400/25'
							: 'text-slate-400 hover:bg-white/5 hover:text-white'}"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="h-5 w-5 shrink-0 {isActive(item.href) ? 'text-indigo-300' : ''}"
							aria-hidden="true">{@html item.icon}</svg
						>
						<span class="flex-1">{item.label}</span>
						{#if item.href === '/notifications' && data.unreadCount > 0}
							<span class="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-indigo-500 px-1.5 text-[10px] font-bold text-white">{data.unreadCount}</span>
						{/if}
					</a>
				{/each}
			</nav>

			<!-- User footer -->
			<div class="border-t border-white/10 p-3">
				<div class="flex items-center gap-3 rounded-lg px-2 py-2">
					<a
						href="/profile"
						class="flex min-w-0 flex-1 items-center gap-3 rounded-md transition hover:bg-white/5"
						title="Your profile"
					>
						<span
							class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-600 to-slate-700 text-xs font-bold text-white ring-1 ring-white/10"
							>{initials}</span
						>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-semibold text-white">{data.user?.displayName}</div>
							<div class="text-xs text-slate-500 capitalize">{data.user?.role}</div>
						</div>
					</a>
					<form method="POST" action="/logout">
						<button
							class="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition hover:bg-white/5 hover:text-red-300"
							title="Sign out"
							aria-label="Sign out"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								class="h-4.5 w-4.5"
								aria-hidden="true"
							>
								<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
								<polyline points="16 17 21 12 16 7" />
								<line x1="21" x2="9" y1="12" y2="12" />
							</svg>
						</button>
					</form>
				</div>
			</div>
		</aside>

		<!-- Main column -->
		<div class="flex min-h-dvh min-w-0 flex-col">
			<!-- Mobile top bar -->
			<header
				class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-white/10 bg-canvas/70 px-4 backdrop-blur-xl lg:hidden"
			>
				<button
					class="grid h-9 w-9 place-items-center rounded-md text-slate-300 hover:bg-white/5"
					aria-label="Open menu"
					onclick={() => (open = true)}
				>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						class="h-5 w-5"><path d="M3 6h18M3 12h18M3 18h18" /></svg
					>
				</button>
				{@render brand('sm')}
			</header>

			<main class="w-full min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
				<div class="mx-auto w-full max-w-[96rem]">
					{@render children()}
				</div>
			</main>
		</div>
	</div>
{/if}
