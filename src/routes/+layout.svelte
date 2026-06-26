<script lang="ts">
	import '../app.css';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toast from '$lib/components/Toast.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/icons';
	import { installPickerInputs } from '$lib/pickerInput';
	import type { ToastVariant } from '$lib/toast';

	let { data, children } = $props();
	let open = $state(false);
	let userMenuDetails = $state<HTMLDetailsElement | null>(null);
	let hamburgerButton = $state<HTMLButtonElement | null>(null);
	let firstNavLink = $state<HTMLAnchorElement | null>(null);
	let searchInput = $state<HTMLInputElement | null>(null);
	let searchValue = $state('');
	let searchTimer = $state<ReturnType<typeof setTimeout> | null>(null);

	const toastMessage = $derived(
		typeof data.flash === 'object' && data.flash !== null ? data.flash.message : (data.flash ?? '')
	);
	const toastVariant = $derived<ToastVariant>(
		typeof data.flash === 'object' && data.flash !== null && data.flash.variant
			? (data.flash.variant as ToastVariant)
			: 'success'
	);

	onMount(() => {
		installPickerInputs();
		if (!browser) return;
		function handleDocumentClick(event: MouseEvent) {
			if (!userMenuDetails) return;
			if (userMenuDetails.open && !userMenuDetails.contains(event.target as Node)) {
				userMenuDetails.open = false;
			}
		}
		document.addEventListener('click', handleDocumentClick);
		return () => document.removeEventListener('click', handleDocumentClick);
	});

	onDestroy(() => {
		if (searchTimer) clearTimeout(searchTimer);
	});

	let wasOpen = false;

	$effect(() => {
		if (!browser) return;
		const isOpen = open;
		if (isOpen && !wasOpen) {
			document.body.classList.add('overflow-hidden');
			queueMicrotask(() => firstNavLink?.focus());
		} else if (!isOpen && wasOpen) {
			document.body.classList.remove('overflow-hidden');
			queueMicrotask(() => hamburgerButton?.focus());
		}
		wasOpen = isOpen;
		return () => {
			document.body.classList.remove('overflow-hidden');
		};
	});

	$effect(() => {
		if (!browser) return;
		const pathname = page.url.pathname;
		const q = page.url.searchParams.get('q') ?? '';
		if (searchInput === document.activeElement) return;
		if (pathname === '/search') {
			searchValue = q;
		} else if (searchValue) {
			searchValue = '';
		}
	});

	function goToSearch() {
		const q = searchValue.trim();
		if (q) {
			goto(`/search?q=${encodeURIComponent(q)}`, { replaceState: true });
		} else {
			goto('/search', { replaceState: true });
		}
	}

	function handleSearchInput() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			goToSearch();
		}, 300);
	}

	function handleSearchKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (searchTimer) clearTimeout(searchTimer);
			goToSearch();
		}
	}

	function isEditableElement(el: HTMLElement): boolean {
		if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
		if (el.isContentEditable) return true;
		if (el.getAttribute('role') === 'textbox') return true;
		return false;
	}

	function handleGlobalKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			open = false;
			return;
		}
		if (event.key !== '/') return;
		const target = event.target as HTMLElement | null;
		if (!target || !searchInput) return;
		if (isEditableElement(target)) return;
		event.preventDefault();
		searchInput.focus();
	}

	function setFirstNavLink(node: HTMLElement, index: number) {
		if (index === 0) firstNavLink = node as HTMLAnchorElement;
		return {
			destroy() {
				if (firstNavLink === node) firstNavLink = null;
			}
		};
	}

	const NAV: { href: string; label: string; icon: IconName }[] = [
		{ href: '/', label: 'Dashboard', icon: 'home' },
		{ href: '/trips', label: 'Trips', icon: 'trips' },
		{ href: '/profile/documents', label: 'Documents', icon: 'document' },
		{ href: '/profile/reminders', label: 'Reminders', icon: 'reminder' },
		{ href: '/profile/loyalty', label: 'Loyalty', icon: 'loyalty' },
		{ href: '/cards', label: 'Cards', icon: 'card' },
		{ href: '/insurance', label: 'Insurance', icon: 'insurance' },
		{ href: '/groups', label: 'Groups', icon: 'group' },
		{ href: '/notifications', label: 'Notifications', icon: 'notification' }
	];
	const SETTINGS: { href: string; label: string; icon: IconName } = {
		href: '/settings',
		label: 'Settings',
		icon: 'settings'
	};

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
			class="brand-mark block shrink-0 overflow-hidden rounded-xl {size ===
			'lg'
				? 'h-9 w-9'
				: 'h-8 w-8'}"
		>
			<img
				src="/logo-transparent.png?v=0.3.1"
				alt=""
				class="brand-logo brand-logo-default h-full w-full object-contain"
				aria-hidden="true"
			/>
			<img
				src="/alt-logo-transparent.png?v=0.3.1"
				alt=""
				class="brand-logo brand-logo-alt h-full w-full object-contain"
				aria-hidden="true"
			/>
		</span>
		<span class="brand-name font-display text-lg font-extrabold">
			{data.instanceName ?? 'Roamarr'}
		</span>
	</a>
{/snippet}

{#snippet userMenu()}
	<details class="app-user-menu relative" bind:this={userMenuDetails}>
		<summary
			class="app-user-summary flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 transition"
			aria-label="User menu"
		>
			<span class="app-avatar grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold"
				>{initials}</span
			>
			<span class="hidden min-w-0 text-left sm:block">
				<span class="app-user-name block max-w-36 truncate text-sm font-semibold">{data.user?.displayName}</span>
				<span class="app-user-role block max-w-36 truncate text-xs">{data.user?.role}</span>
			</span>
		</summary>
		<div class="app-user-menu-panel absolute right-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-lg border shadow-2xl">
			<div class="flex items-center gap-3 border-b p-4">
				<span class="app-avatar grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold"
					>{initials}</span
				>
				<div class="min-w-0">
					<p class="app-user-name truncate text-sm font-semibold">{data.user?.displayName}</p>
					<p class="app-user-role truncate text-xs">{data.user?.email}</p>
				</div>
			</div>
			<div class="p-2">
				<a href="/profile" class="app-user-menu-item">
					<Icon name="user" class="h-4.5 w-4.5" />
					<span>Profile</span>
				</a>
				{#if data.user?.role === 'admin'}
					<a href="/settings" class="app-user-menu-item">
						<Icon name="settings" class="h-4.5 w-4.5" />
						<span>Settings</span>
					</a>
				{/if}
				<form method="POST" action="/logout">
					<button class="app-user-menu-item app-user-menu-button w-full" type="submit">
						<Icon name="logout" class="h-4.5 w-4.5" />
						<span>Sign Out</span>
					</button>
				</form>
			</div>
		</div>
	</details>
{/snippet}

<svelte:head>
	<meta name="theme-color" content={data.themeColor} />
</svelte:head>

<svelte:window onkeydown={handleGlobalKeydown} />

	<div class="theme-root" data-theme={data.themeId}>
	{#key toastMessage}
		<Toast message={toastMessage} variant={toastVariant} />
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
			class="app-sidebar fixed inset-y-0 left-0 z-40 flex h-dvh w-64 flex-col border-r backdrop-blur-xl transition-transform duration-200 lg:sticky lg:top-0 lg:translate-x-0 {open
				? 'translate-x-0'
				: '-translate-x-full'}"
		>
			<div class="flex h-16 items-center px-5">
				{@render brand('lg')}
			</div>

			<nav class="flex-1 space-y-1 overflow-y-auto px-3 py-2">
				{#each navItems as item, i (item.href)}
					<a
						use:setFirstNavLink={i}
						href={item.href}
						onclick={() => (open = false)}
						aria-current={isActive(item.href) ? 'page' : undefined}
						class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition {isActive(
							item.href
						)
							? 'app-nav-item-active'
							: 'app-nav-item'}"
					>
						<Icon
							name={item.icon}
							class="h-5 w-5 {isActive(item.href) ? 'app-nav-icon-active' : ''}"
						/>
						<span class="flex-1">{item.label}</span>
						{#if item.href === '/notifications' && data.unreadCount > 0}
							<span class="app-unread-count grid h-5 min-w-[1.25rem] place-items-center rounded-full px-1.5 text-[10px] font-bold">{data.unreadCount}</span>
						{/if}
					</a>
				{/each}
			</nav>

			<!-- App footer -->
			<div class="app-sidebar-footer border-t p-3">
				<a
					href="/settings/about"
					class="app-version-link flex items-center gap-3 rounded-lg px-3 py-2 transition"
					title="{data.appName} {data.appVersion}"
				>
					<Icon name="info" class="h-5 w-5" />
					<span class="min-w-0">
						<span class="app-version-name block truncate text-sm font-semibold">{data.appName}</span>
						<span class="app-version-number block font-mono text-xs">{data.appVersion}</span>
					</span>
				</a>
			</div>
		</aside>

		<!-- Main column -->
		<div class="flex min-h-dvh min-w-0 flex-col">
			<!-- App top bar -->
			<header
				class="app-topbar sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b px-4 py-2 backdrop-blur-xl sm:px-6 lg:px-8"
			>
				<button
					bind:this={hamburgerButton}
					class="icon-button lg:hidden"
					aria-label="Open menu"
					onclick={() => (open = true)}
				>
					<Icon name="menu" class="h-5 w-5" />
				</button>
				<div class="hidden min-w-0 sm:block lg:hidden">
					{@render brand('sm')}
				</div>
				<form
					class="app-search flex min-w-0 flex-1 items-center gap-2 rounded-full px-3 py-2"
					role="search"
					onsubmit={(event) => event.preventDefault()}
				>
					<label class="sr-only" for="app-shell-search">Search</label>
					<Icon name="search" class="h-4.5 w-4.5" />
					<input
						bind:this={searchInput}
						bind:value={searchValue}
						oninput={handleSearchInput}
						onkeydown={handleSearchKeydown}
						id="app-shell-search"
						type="search"
						class="app-search-input min-w-0 flex-1 bg-transparent text-sm outline-none"
						placeholder="Search trips, plans, documents"
						autocomplete="off"
					/>
				</form>
				{@render userMenu()}
			</header>

			<main class="w-full min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
				<div class="mx-auto w-full max-w-[96rem]">
					{@render children()}
				</div>
			</main>
		</div>
		</div>
	{/if}
</div>
