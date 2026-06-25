<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import Toast from '$lib/components/Toast.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/components/Icon.svelte';
	import { installPickerInputs } from '$lib/pickerInput';
	import type { ToastVariant } from '$lib/components/Toast.svelte';

	let { data, children } = $props();
	let open = $state(false);
	let hamburgerButton = $state<HTMLButtonElement | null>(null);
	let firstNavLink = $state<HTMLAnchorElement | null>(null);

	const toastMessage = $derived(
		typeof data.flash === 'object' && data.flash !== null ? data.flash.message : (data.flash ?? '')
	);
	const toastVariant = $derived<ToastVariant>(
		typeof data.flash === 'object' && data.flash !== null && data.flash.variant
			? (data.flash.variant as ToastVariant)
			: 'success'
	);

	onMount(() => installPickerInputs());

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

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			open = false;
		}
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
			class="brand-mark grid place-items-center rounded-xl {size ===
			'lg'
				? 'h-9 w-9'
				: 'h-8 w-8'}"
		>
			<svg
				viewBox="0 0 24 24"
				fill="currentColor"
				class="h-4.5 w-4.5 text-white"
				style="color: var(--theme-accent-text)"
				aria-hidden="true"
			>
				<polygon points="3 11 22 2 13 21 11 13 3 11" />
			</svg>
		</span>
		<span class="brand-name font-display text-lg font-extrabold">
			{data.instanceName ?? 'Roamarr'}
		</span>
	</a>
{/snippet}

<svelte:head>
	<meta name="theme-color" content={data.themeColor} />
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

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

			<!-- User footer -->
			<div class="app-sidebar-footer border-t p-3">
				<div class="flex items-center gap-3 rounded-lg px-2 py-2">
					<a
						href="/profile"
						class="app-user-link flex min-w-0 flex-1 items-center gap-3 rounded-md transition"
						title="Your profile"
					>
						<span
							class="app-avatar grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold"
							>{initials}</span
						>
						<div class="min-w-0 flex-1">
							<div class="app-user-name truncate text-sm font-semibold">{data.user?.displayName}</div>
							<div class="app-user-role text-xs capitalize">{data.user?.role}</div>
						</div>
					</a>
					<form method="POST" action="/logout">
						<button
							class="icon-button icon-button-danger h-8 w-8"
							title="Sign out"
							aria-label="Sign out"
						>
							<Icon name="logout" class="h-4.5 w-4.5" />
						</button>
					</form>
				</div>
			</div>
		</aside>

		<!-- Main column -->
		<div class="flex min-h-dvh min-w-0 flex-col">
			<!-- Mobile top bar -->
			<header
				class="app-topbar sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-xl lg:hidden"
			>
				<button
					bind:this={hamburgerButton}
					class="icon-button text-slate-300"
					aria-label="Open menu"
					onclick={() => (open = true)}
				>
					<Icon name="menu" class="h-5 w-5" />
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
</div>
