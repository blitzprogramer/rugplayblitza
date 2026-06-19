<script lang="ts">
	import { page } from '$app/stores';
	import { USER_DATA } from '$lib/stores/user-data';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Shield01Icon,
		UserGroupIcon,
		Ticket01Icon,
		Analytics01Icon,
		Notification01Icon,
		Coins02Icon,
		ArrowUpDownIcon,
		Robot02Icon
	} from '@hugeicons/core-free-icons';

	let { children } = $props();

	const nav = [
		{ href: '/admin', label: 'Overview', icon: Analytics01Icon, exact: true },
		{ href: '/admin/users', label: 'Users', icon: UserGroupIcon },
		{ href: '/admin/promo', label: 'Promo Codes', icon: Ticket01Icon },
		{ href: '/admin/notify', label: 'Broadcast', icon: Notification01Icon },
		{ href: '/admin/coins', label: 'Featured Coins', icon: Coins02Icon },
		{ href: '/admin/hopium', label: 'Hopium', icon: ArrowUpDownIcon },
		{ href: '/admin/bots', label: 'Bots', icon: Robot02Icon }
	];

	function isActive(href: string, exact = false): boolean {
		return exact ? $page.url.pathname === href : $page.url.pathname.startsWith(href);
	}
</script>

<svelte:head>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if !$USER_DATA || !$USER_DATA.isAdmin}
	<div class="flex h-screen items-center justify-center">
		<div class="text-center">
			<HugeiconsIcon icon={Shield01Icon} class="text-muted-foreground mx-auto mb-3 h-10 w-10" />
			<h1 class="text-2xl font-bold">Access Denied</h1>
			<p class="text-muted-foreground">You don't have permission to access this page.</p>
		</div>
	</div>
{:else}
	<header class="border-b">
		<div class="container mx-auto max-w-6xl space-y-3 px-4 pt-6">
			<div class="flex items-center gap-2">
				<HugeiconsIcon icon={Shield01Icon} class="text-primary h-5 w-5" />
				<h1 class="text-2xl font-bold">Admin</h1>
			</div>
			<nav class="flex flex-wrap gap-1 pb-3">
				{#each nav as item (item.href)}
					<a
						href={item.href}
						class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {isActive(
							item.href,
							item.exact
						)
							? 'bg-primary text-primary-foreground'
							: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
					>
						<HugeiconsIcon icon={item.icon} class="h-4 w-4" />
						{item.label}
					</a>
				{/each}
			</nav>
		</div>
	</header>
	{@render children()}
{/if}
