<script setup lang="ts">
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger } from 'reka-ui';
import { router } from '@inertiajs/vue3';
import type { Component } from 'vue';
import { floating, menuItem } from './styles';

export interface MenuEntry {
    key: string;
    label: string;
    /** A second line under the label in caption style, e.g. "Braucht eine Freigabe" (DQ-539). */
    caption?: string;
    icon?: Component;
    /** Inertia visit on select. */
    href?: string;
    /** Opens in a new tab / downloads (plain link). */
    external?: boolean;
    onSelect?: () => void;
    danger?: boolean;
    disabled?: boolean;
    /** Draws a separator above this entry. */
    separated?: boolean;
    testId?: string;
}

/** Trigger in the `trigger` slot (one focusable element, e.g. Button or IconButton). Entries via `items`, or free content in the default slot. */
withDefaults(defineProps<{ items?: MenuEntry[]; label?: string; align?: 'start' | 'center' | 'end' }>(), { items: () => [], label: undefined, align: 'end' });

function select(entry: MenuEntry): void {
    if (entry.onSelect) entry.onSelect();
    else if (entry.href && entry.external) window.open(entry.href, '_blank', 'noopener');
    else if (entry.href) router.visit(entry.href);
}
</script>

<template>
    <DropdownMenuRoot :modal="false">
        <DropdownMenuTrigger as-child>
            <slot name="trigger" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
            <DropdownMenuContent :align="align" :side-offset="4" :class="[floating, 'min-w-200 max-w-320']">
                <DropdownMenuLabel v-if="label" class="px-8 py-4 text-caption text-ink-3">{{ label }}</DropdownMenuLabel>
                <slot />
                <template v-for="entry in items" :key="entry.key">
                    <DropdownMenuSeparator v-if="entry.separated" class="my-4 h-px bg-line-subtle" />
                    <DropdownMenuItem :disabled="entry.disabled" :class="[menuItem, entry.danger ? 'text-danger' : '', entry.caption ? 'h-auto items-start py-4' : '']" :data-testid="entry.testId" @select="select(entry)">
                        <component :is="entry.icon" v-if="entry.icon" :size="16" :class="entry.caption ? 'mt-2 shrink-0' : 'shrink-0'" aria-hidden="true" />
                        <span v-if="entry.caption" class="flex min-w-0 flex-col">
                            <span>{{ entry.label }}</span>
                            <span class="text-caption text-ink-3">{{ entry.caption }}</span>
                        </span>
                        <span v-else class="truncate">{{ entry.label }}</span>
                    </DropdownMenuItem>
                </template>
            </DropdownMenuContent>
        </DropdownMenuPortal>
    </DropdownMenuRoot>
</template>
