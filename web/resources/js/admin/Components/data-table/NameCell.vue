<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { focusRing } from '../ui/styles';

/**
 * The key cell of a list row (DQ-526): the name on line 1 (never truncated in a `grow` column: it wraps to at most two lines), an
 * optional caption on line 2 in caption style (a nickname, an owner), both with their full text as title. With `href` the name
 * is the row's link, so the keyboard reaches the record from the first cell.
 */
withDefaults(defineProps<{ name: string; caption?: string | null; href?: string | null; testId?: string }>(), { caption: null, href: null, testId: undefined });
</script>

<template>
    <!-- 36 px with a caption, so a 40 px row stays 40; the link is at least 32 high, a full target even when the name wraps (ADR-212). -->
    <Link v-if="href" :href="href" :title="caption ? `${name} · ${caption}` : name" :class="[focusRing, 'group/name flex min-h-32 min-w-0 flex-col justify-center rounded-xs']" :data-testid="testId">
        <span class="line-clamp-2 text-admin-base text-ink group-hover/name:underline">{{ name }}</span>
        <span v-if="caption" class="truncate text-caption text-ink-3">{{ caption }}</span>
    </Link>
    <span v-else class="flex min-h-32 min-w-0 flex-col justify-center" :title="caption ? `${name} · ${caption}` : name">
        <span class="line-clamp-2 text-admin-base text-ink">{{ name }}</span>
        <span v-if="caption" class="truncate text-caption text-ink-3">{{ caption }}</span>
    </span>
</template>
