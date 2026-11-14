<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { useSlots } from 'vue';
import HoverPreview from '../ui/HoverPreview.vue';
import { focusRing } from '../ui/styles';

/**
 * The key cell of a list row (DQ-526): the name on line 1 (never truncated in a `grow` column: it wraps to at most two lines), an
 * optional caption on line 2 in caption style (a nickname, an owner), both with their full text as title. With `href` the name
 * is the row's link, so the keyboard reaches the record from the first cell.
 *
 * M4.17 (09 §10.2): a `preview` slot shows the row hover preview beside the link; `current` marks the row open in a SplitQueue pane.
 */
withDefaults(defineProps<{ name: string; caption?: string | null; href?: string | null; testId?: string; current?: boolean }>(), { caption: null, href: null, testId: undefined, current: false });
const slots = useSlots();
</script>

<template>
    <!-- 36 px with a caption, so a 40 px row stays 40; the link is at least 32 high, a full target even when the name wraps (ADR-212). -->
    <HoverPreview v-if="href" :disabled="!slots.preview" :test-id="testId ? `${testId}.preview-card` : undefined">
        <Link
            :href="href"
            :title="slots.preview ? undefined : caption ? `${name} · ${caption}` : name"
            :aria-current="current ? 'true' : undefined"
            :class="[focusRing, 'group/name flex min-h-32 min-w-0 flex-col justify-center rounded-xs']"
            :data-testid="testId"
        >
            <span class="line-clamp-2 text-admin-base group-hover/name:underline" :class="current ? 'text-admin-base-strong text-ink' : 'text-ink'">{{ name }}</span>
            <span v-if="caption" class="truncate text-caption text-ink-3">{{ caption }}</span>
        </Link>
        <template #preview><slot name="preview" /></template>
    </HoverPreview>
    <span v-else class="flex min-h-32 min-w-0 flex-col justify-center" :title="caption ? `${name} · ${caption}` : name">
        <span class="line-clamp-2 text-admin-base text-ink">{{ name }}</span>
        <span v-if="caption" class="truncate text-caption text-ink-3">{{ caption }}</span>
    </span>
</template>
