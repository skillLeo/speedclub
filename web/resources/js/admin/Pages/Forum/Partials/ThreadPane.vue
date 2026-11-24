<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import {
    PhArrowSquareOut,
    PhArrowsClockwise,
    PhArrowsMerge,
    PhCheck,
    PhCheckCircle,
    PhDotsThree,
    PhEyeSlash,
    PhFlag,
    PhFolderSimple,
    PhLockSimple,
    PhLockSimpleOpen,
    PhProhibit,
    PhPushPin,
    PhPushPinSlash,
    PhX,
} from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useAdminAction } from '../../../Components/decisions/action';
import HideDialog from '../../../Components/decisions/HideDialog.vue';
import StateBlock from '../../../Components/patterns/StateBlock.vue';
import { Badge, Button, DropdownMenu, IconButton, StatusPill, type MenuEntry } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { qaDialog } from '../../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../../lib/format';
import { hasRoute } from '../../../lib/routes';
import {
    banUrl,
    caseHref,
    caseTones,
    memberHref,
    postActionUrl,
    postTones,
    threadToolUrl,
    threadTones,
    type CategoryOption,
    type ForumPostItem,
    type ForumSelected,
    type ThreadTool,
    type ToolMode,
} from '../shared';
import ForumBanDialog from './ForumBanDialog.vue';
import ThreadToolDialog from './ThreadToolDialog.vue';

/**
 * The right pane of ADM-68 (09 §10.2 SplitQueue, m5.8-contract §6 `selected`): the thread as staff see it (every post in every state,
 * oldest first after the opening post, the sanitised Markdown subset), its photos and DSA cases, the pre-moderation decision of the
 * focused post (emitted: the queue owns the keys a/r and the auto-advance), and the staff tools: anheften, schließen, verschieben,
 * zusammenführen, Lösung korrigieren, Ausblenden (a DSA remove_content decision with a statement of reasons) and the Forum-Sperre of the
 * author (DSA restriction). Restoring a hidden post is the reversal of its decision on ADM-21 (the case link). Every tool is a ⚿ write.
 */
const props = defineProps<{
    selected: ForumSelected;
    categories: CategoryOption[];
    /** Merge targets from the list on screen. */
    suggestions: { id: string; title: string }[];
    mayDecide: boolean;
    mayBan: boolean;
    /** The pending post the keys a/r decide (the opened item, else the first pending post). */
    focusPostId: string | null;
    decision: { processing: string | null; conflict: boolean; error: string | null };
    testId: string;
}>();
const emit = defineEmits<{ approve: [post: ForumPostItem]; reject: [post: ForumPostItem]; reload: []; close: [] }>();

const thread = computed(() => props.selected.thread);
const posts = computed(() => props.selected.posts);
const author = computed(() => thread.value.author);
const published = computed(() => thread.value.status === 'published');
const canDecide = computed(() => props.mayDecide && props.selected.can.decide);
const canBan = computed(() => props.mayBan && props.selected.can.ban && author.value !== null);
const focusPost = computed(() => posts.value.find((p) => p.id === props.focusPostId) ?? null);
const categoryName = computed(() => thread.value.category?.name ?? '–');
const casesOf = (post: ForumPostItem) => props.selected.cases.filter((c) => c.post_id === post.id);
const parentAuthor = (post: ForumPostItem): string | null => {
    if (post.parent_id === null) return null;
    const parent = posts.value.find((p) => p.id === post.parent_id);
    return parent?.author?.username ?? null;
};
const excerpt = (post: ForumPostItem): string => (post.body.length > 200 ? `${post.body.slice(0, 199)}…` : post.body);
const kindLabel = (post: ForumPostItem): string => {
    if (post.is_opening) return trans('forum.pane.opening');
    const to = parentAuthor(post);
    return to ? trans('forum.pane.nested_reply', { username: to }) : trans('forum.pane.reply');
};

// ---- tools ------------------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const toolOpen = ref(false);
const toolMode = ref<ToolMode>('move');
const solutionTarget = ref<{ postId: string | null; author: string | null; excerpt: string } | null>(null);
const hideOpen = ref(false);
const hideTarget = ref<ForumPostItem | null>(null);
const banOpen = ref(false);
const running = ref<ThreadTool | null>(null);

function flip(tool: 'pin' | 'unpin' | 'lock' | 'unlock'): void {
    running.value = tool;
    action.run('post', threadToolUrl(thread.value.id, tool), {}, { sensitive: true, onSuccess: () => (running.value = null) });
}
watch(action.processing, (busy) => {
    if (!busy) running.value = null;
});
function openTool(mode: ToolMode, post: ForumPostItem | null = null): void {
    action.reset();
    toolMode.value = mode;
    solutionTarget.value = mode === 'solution' ? { postId: post?.id ?? null, author: post?.author?.username ?? null, excerpt: post ? excerpt(post) : '' } : null;
    toolOpen.value = true;
}
function submitTool(payload: Record<string, string | number | null>): void {
    action.run('post', threadToolUrl(thread.value.id, toolMode.value), payload, { sensitive: true, onSuccess: () => (toolOpen.value = false) });
}
function openHide(post: ForumPostItem): void {
    action.reset();
    hideTarget.value = post;
    hideOpen.value = true;
}
function submitHide(payload: Record<string, string | null>): void {
    if (hideTarget.value === null) return;
    action.run('post', postActionUrl(hideTarget.value.id, 'hide'), payload, { sensitive: true, onSuccess: () => (hideOpen.value = false) });
}
function openBan(): void {
    action.reset();
    banOpen.value = true;
}
function submitBan(payload: Record<string, string | null>): void {
    if (author.value === null) return;
    action.run('post', banUrl(author.value.id), payload, { sensitive: true, onSuccess: () => (banOpen.value = false) });
}

const moreTools = computed<MenuEntry[]>(() => [
    { key: 'move', label: trans('forum.tools.move'), icon: PhFolderSimple, onSelect: () => openTool('move'), testId: `${props.testId}.tools.move` },
    ...(published.value ? [{ key: 'merge', label: trans('forum.tools.merge'), icon: PhArrowsMerge, onSelect: () => openTool('merge'), testId: `${props.testId}.tools.merge` }] : []),
    ...(published.value && thread.value.solved_post_id
        ? [{ key: 'solution-clear', label: trans('forum.tools.solution_clear'), icon: PhX, onSelect: () => openTool('solution', null), testId: `${props.testId}.tools.solution-clear` }]
        : []),
]);
function postMenu(post: ForumPostItem): MenuEntry[] {
    const entries: MenuEntry[] = [];
    if (published.value && !post.is_opening && post.status === 'published' && !post.deleted) {
        entries.push(
            thread.value.solved_post_id === post.id
                ? { key: 'solution-clear', label: trans('forum.tools.solution_clear'), icon: PhX, onSelect: () => openTool('solution', null), testId: `${props.testId}.post.solution-clear` }
                : { key: 'solution', label: trans('forum.tools.solution'), icon: PhCheckCircle, onSelect: () => openTool('solution', post), testId: `${props.testId}.post.solution` },
        );
    }
    if (post.status !== 'removed' && !post.deleted) {
        entries.push({ key: 'hide', label: trans('forum.post.hide'), icon: PhEyeSlash, danger: true, separated: entries.length > 0, onSelect: () => openHide(post), testId: `${props.testId}.post.hide` });
    }
    return entries;
}

// ---- the opened item: scrolled into view ------------------------------------------------------------------------------------
const list = ref<HTMLElement | null>(null);
async function showItem(): Promise<void> {
    await nextTick();
    const id = props.selected.item;
    if (!id || !list.value) return;
    list.value.querySelector<HTMLElement>(`[data-post-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}
watch(() => `${thread.value.id}:${props.selected.item ?? ''}`, showItem);

// QA cells (?dialog=): hide · ban · move · merge · solution.
onMounted(() => {
    void showItem();
    const dialog = qaDialog();
    if (!canDecide.value && dialog !== 'ban') return;
    const target = posts.value.find((p) => p.id === props.selected.item) ?? posts.value.find((p) => !p.is_opening && p.status === 'published') ?? posts.value[0];
    if (dialog === 'hide' && target) openHide(target);
    else if (dialog === 'ban' && canBan.value) openBan();
    else if (dialog === 'move' || dialog === 'merge') openTool(dialog);
    else if (dialog === 'solution') openTool('solution', posts.value.find((p) => !p.is_opening && p.status === 'published') ?? null);
});

const prose =
    'max-w-720 text-admin-base text-ink break-words [&_a]:text-ink [&_a]:underline [&_li]:mb-4 [&_ol]:mb-12 [&_ol]:list-decimal [&_ol]:pl-20 [&_p]:mb-12 [&_p:last-child]:mb-0 [&_ul]:mb-12 [&_ul]:list-disc [&_ul]:pl-20';
</script>

<template>
    <div class="flex flex-col gap-20" :data-testid="`${testId}.thread`">
        <header class="flex flex-wrap items-start justify-between gap-12">
            <div class="flex min-w-0 flex-col gap-4">
                <h2 class="text-headline text-ink" :data-testid="`${testId}.title`">{{ thread.title }}</h2>
                <p class="flex flex-wrap items-center gap-8 text-admin-base text-ink-2">
                    <StatusPill :tone="threadTones[thread.status]" :label="trans(`forum.status.thread.${thread.status}`)" :data-testid="`${testId}.status`" />
                    <span>{{ categoryName }}</span>
                    <Badge v-if="thread.is_pinned"><PhPushPin :size="16" aria-hidden="true" />{{ trans('forum.flags.pinned') }}</Badge>
                    <Badge v-if="thread.is_locked"><PhLockSimple :size="16" aria-hidden="true" />{{ trans('forum.flags.locked') }}</Badge>
                    <Badge v-if="thread.solved_post_id" tone="success">{{ trans('forum.flags.solved') }}</Badge>
                    <Badge v-if="thread.is_sample">{{ trans('forum.sample') }}</Badge>
                </p>
                <p v-if="thread.tags.length > 0 || thread.vehicle" class="flex flex-wrap items-center gap-8 text-caption text-ink-3">
                    <span v-for="tag in thread.tags" :key="tag" class="sc-key">#{{ tag }}</span>
                    <span v-if="thread.vehicle">{{ trans('forum.pane.vehicle', { title: thread.vehicle.title ?? '–' }) }}</span>
                </p>
            </div>
            <IconButton :icon="PhX" size="sm" :label="trans('forum.pane.close')" :data-testid="`${testId}.close`" @click="emit('close')" />
        </header>

        <p v-if="thread.status === 'merged' && thread.merged_into_id" class="flex flex-wrap items-center gap-8 text-admin-base text-ink-2" :data-testid="`${testId}.merged`">
            {{ trans('forum.pane.merged') }}
            <Link :href="`?tab=threads&thread=${thread.merged_into_id}`" :class="[focusRing, 'rounded-xs text-admin-base-strong text-ink hover:underline']">{{ trans('forum.pane.merged_open') }}</Link>
        </p>

        <!-- The author: who wrote it, how new the account is, the forum restriction in force, the ban. -->
        <section class="flex flex-wrap items-center justify-between gap-12 border-y border-line-subtle py-12" :aria-label="trans('forum.pane.author')" :data-testid="`${testId}.author`">
            <div v-if="author" class="flex min-w-0 flex-col gap-2">
                <Link v-if="hasRoute('admin.members.show')" :href="memberHref(author.id)" :class="[focusRing, 'sc-key inline-flex min-h-32 items-center self-start rounded-xs text-admin-base-strong text-ink hover:underline']">{{ `@${author.username ?? '–'}` }}</Link>
                <span v-else class="sc-key text-admin-base-strong text-ink">{{ `@${author.username ?? '–'}` }}</span>
                <span class="text-caption text-ink-3 tabular-nums">
                    {{ trans('forum.pane.joined', { date: formatDate(author.joined_at) }) }} ·
                    {{ trans(author.email_verified ? 'forum.pane.verified' : 'forum.pane.unverified') }}
                </span>
                <span v-if="author.forum_restricted" class="flex items-center gap-4 text-caption text-warning" :data-testid="`${testId}.author.restricted`">
                    <PhProhibit :size="16" aria-hidden="true" />
                    {{ author.forum_restricted_until ? trans('forum.ban.current_until', { date: formatDateTime(author.forum_restricted_until) }) : trans('forum.ban.current_open') }}
                </span>
            </div>
            <p v-else class="text-admin-base text-ink-3">{{ trans('forum.pane.deleted_author') }}</p>
            <Button v-if="canBan" size="sm" variant="destructive" :icon="PhProhibit" :data-testid="`${testId}.ban`" @click="openBan">{{ trans('forum.ban.open') }}</Button>
        </section>

        <StateBlock v-if="decision.conflict" kind="partial" :title="trans('forum.conflict.title')" :body="trans('forum.conflict.changed')" :retryable="false" :test-id="`${testId}.conflict`">
            <div class="mt-8">
                <Button size="sm" variant="secondary" :icon="PhArrowsClockwise" :data-testid="`${testId}.conflict.reload`" @click="emit('reload')">{{ trans('forum.actions.reload') }}</Button>
            </div>
        </StateBlock>
        <p v-else-if="decision.error" class="text-admin-base text-danger" role="alert" :data-testid="`${testId}.decision-error`">{{ decision.error }}</p>

        <!-- Pre-moderation of the focused post: one primary, keys a/r. -->
        <div v-if="canDecide && focusPost" class="flex flex-wrap items-center gap-8 border-b border-line-subtle pb-12" :data-testid="`${testId}.decide`">
            <p class="basis-full text-admin-base text-ink-2">{{ trans(focusPost.is_opening ? 'forum.decide.thread' : 'forum.decide.reply', { username: focusPost.author?.username ?? '–' }) }}</p>
            <Button size="sm" variant="primary" :icon="PhCheck" :loading="decision.processing === 'approve'" :disabled="decision.processing !== null || decision.conflict" aria-keyshortcuts="a" :data-testid="`${testId}.approve`" @click="emit('approve', focusPost)">
                {{ trans('forum.actions.approve') }}
            </Button>
            <Button size="sm" variant="destructive" :icon="PhX" :disabled="decision.processing !== null || decision.conflict" aria-keyshortcuts="r" :data-testid="`${testId}.reject`" @click="emit('reject', focusPost)">
                {{ trans('forum.actions.reject') }}
            </Button>
            <p class="ml-auto text-caption text-ink-3">{{ trans('forum.keys') }}</p>
        </div>

        <!-- Staff tools of the thread (pin, lock without a dialog; the rest with one). -->
        <div v-if="canDecide && (published || thread.status === 'pending')" class="flex flex-wrap items-center gap-8" role="toolbar" :aria-label="trans('forum.tools.label')" :data-testid="`${testId}.tools`">
            <template v-if="published">
                <Button size="sm" variant="secondary" :icon="thread.is_pinned ? PhPushPinSlash : PhPushPin" :loading="running === 'pin' || running === 'unpin'" :disabled="action.processing.value" :data-testid="`${testId}.tools.pin`" @click="flip(thread.is_pinned ? 'unpin' : 'pin')">
                    {{ trans(thread.is_pinned ? 'forum.tools.unpin' : 'forum.tools.pin') }}
                </Button>
                <Button size="sm" variant="secondary" :icon="thread.is_locked ? PhLockSimpleOpen : PhLockSimple" :loading="running === 'lock' || running === 'unlock'" :disabled="action.processing.value" :data-testid="`${testId}.tools.lock`" @click="flip(thread.is_locked ? 'unlock' : 'lock')">
                    {{ trans(thread.is_locked ? 'forum.tools.unlock' : 'forum.tools.lock') }}
                </Button>
            </template>
            <DropdownMenu :items="moreTools" :label="trans('forum.tools.more')">
                <template #trigger>
                    <Button size="sm" variant="ghost" :icon="PhDotsThree" :data-testid="`${testId}.tools.more`">{{ trans('forum.tools.more') }}</Button>
                </template>
            </DropdownMenu>
            <p v-if="action.error.value && !toolOpen && !hideOpen && !banOpen" class="basis-full text-admin-base text-danger" role="alert" :data-testid="`${testId}.tools.error`">{{ action.error.value }}</p>
        </div>

        <!-- DSA cases of this thread's posts: decided on ADM-21. -->
        <section v-if="selected.cases.length > 0" class="flex flex-col gap-8" :aria-label="trans('forum.pane.cases')" :data-testid="`${testId}.cases`">
            <h3 class="text-admin-base-strong text-ink">{{ trans('forum.pane.cases') }}</h3>
            <ul class="flex flex-col gap-4">
                <li v-for="item in selected.cases" :key="item.id" class="flex flex-wrap items-center gap-8 text-admin-base text-ink-2">
                    <StatusPill :tone="caseTones[item.status]" :label="trans(`forum.case_status.${item.status}`)" />
                    <span class="tabular-nums">{{ trans('forum.pane.case_line', { count: formatNumber(item.reports), date: formatDate(item.opened_at) }) }}</span>
                    <Link :href="caseHref(item.id)" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 rounded-xs text-admin-base-strong text-ink hover:underline']" :data-testid="`${testId}.case`">
                        {{ trans(item.open ? 'forum.pane.case_decide' : 'forum.pane.case_open') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                    </Link>
                </li>
            </ul>
        </section>

        <ul v-if="selected.photos.length > 0" class="grid grid-cols-3 gap-8" :aria-label="trans('forum.pane.photos')" :data-testid="`${testId}.photos`">
            <li v-for="(photo, index) in selected.photos" :key="photo.id" class="aspect-4/3 overflow-hidden rounded-xs bg-raised">
                <a v-if="photo.url_640" :href="photo.url_640" target="_blank" rel="noopener" :class="[focusRing, 'block size-full']">
                    <img :src="photo.url_320 ?? photo.url_640" :alt="trans('forum.pane.photo_alt', { index: formatNumber(index + 1), total: formatNumber(selected.photos.length) })" class="block size-full object-cover" loading="lazy" />
                </a>
            </li>
        </ul>

        <ol ref="list" class="flex flex-col" :aria-label="trans('forum.pane.posts', { count: formatNumber(posts.length) })" :data-testid="`${testId}.posts`">
            <li
                v-for="post in posts"
                :key="post.id"
                :data-post-id="post.id"
                class="flex flex-col gap-8 border-t border-line-subtle py-16 first:border-t-0 first:pt-0"
                :class="[post.parent_id ? 'pl-24' : post.id === selected.item ? 'pl-12' : '', post.id === selected.item ? 'border-l-2 border-l-ink' : '']"
                :aria-current="post.id === selected.item ? 'true' : undefined"
                :data-testid="`${testId}.post`"
            >
                <div class="flex flex-wrap items-center gap-8">
                    <span class="sc-key text-admin-base-strong text-ink">{{ post.author ? `@${post.author.username ?? '–'}` : trans('forum.pane.deleted_author') }}</span>
                    <span class="text-caption text-ink-3 tabular-nums">
                        {{ kindLabel(post) }} ·
                        <time :datetime="post.created_at ?? undefined">{{ formatDateTime(post.created_at) }}</time>
                        <template v-if="post.edited_at"> · {{ trans('forum.pane.edited') }}</template>
                    </span>
                    <StatusPill v-if="post.status !== 'published'" :tone="postTones[post.status]" :label="trans(`forum.status.post.${post.status}`)" />
                    <Badge v-if="post.deleted">{{ trans('forum.pane.deleted') }}</Badge>
                    <Badge v-if="thread.solved_post_id === post.id" tone="success">{{ trans('forum.flags.solution') }}</Badge>
                    <span class="ml-auto flex items-center gap-4">
                        <span v-if="!post.is_opening" class="text-caption text-ink-3 tabular-nums" :title="trans('forum.pane.helpful_hint')">{{ trans('forum.pane.helpful', { count: formatNumber(post.helpful_count) }) }}</span>
                        <DropdownMenu v-if="canDecide && postMenu(post).length > 0" :items="postMenu(post)" :label="trans('forum.post.menu')">
                            <template #trigger>
                                <IconButton :icon="PhDotsThree" size="sm" :label="trans('forum.post.menu_named', { username: post.author?.username ?? '–' })" :data-testid="`${testId}.post.menu`" />
                            </template>
                        </DropdownMenu>
                    </span>
                </div>
                <!-- eslint-disable-next-line vue/no-v-html -- body_html is the server's sanitised Markdown subset (ForumMarkdown, m5.8-contract D5) -->
                <div :class="[prose, post.deleted || post.status === 'removed' ? 'text-ink-2' : '']" v-html="post.body_html" />
                <div v-if="casesOf(post).length > 0 || (canDecide && post.status === 'pending' && post.id !== focusPostId)" class="flex flex-wrap items-center gap-8">
                    <span v-for="item in casesOf(post)" :key="item.id" class="flex items-center gap-4 text-caption text-ink-2 tabular-nums">
                        <PhFlag :size="16" aria-hidden="true" />{{ trans('forum.pane.post_reports', { count: formatNumber(item.reports) }) }}
                    </span>
                    <template v-if="canDecide && post.status === 'pending' && post.id !== focusPostId">
                        <Button size="sm" variant="secondary" :icon="PhCheck" :disabled="decision.processing !== null" :data-testid="`${testId}.post.approve`" @click="emit('approve', post)">{{ trans('forum.actions.approve') }}</Button>
                        <Button size="sm" variant="ghost" :icon="PhX" :disabled="decision.processing !== null" :data-testid="`${testId}.post.reject`" @click="emit('reject', post)">{{ trans('forum.actions.reject') }}</Button>
                    </template>
                </div>
                <p v-if="post.status === 'removed'" class="text-caption text-ink-3">{{ trans('forum.pane.removed_note') }}</p>
            </li>
        </ol>

        <ThreadToolDialog
            v-model:open="toolOpen"
            :mode="toolMode"
            :thread-title="thread.title"
            :category-id="thread.category?.id ?? null"
            :categories="categories"
            :suggestions="suggestions.filter((s) => s.id !== thread.id)"
            :solution="solutionTarget"
            :processing="action.processing.value"
            :error="action.error.value"
            :test-id="`${testId}.tool-dialog`"
            @submit="submitTool"
        />
        <HideDialog
            v-model:open="hideOpen"
            :title="trans(hideTarget?.is_opening ? 'forum.hide.title_thread' : 'forum.hide.title_reply', { username: hideTarget?.author?.username ?? '–' })"
            :description="trans(hideTarget?.is_opening ? 'forum.hide.body_thread' : 'forum.hide.body_reply')"
            subject="post"
            :confirm-label="trans('forum.hide.submit')"
            :processing="action.processing.value"
            :error="action.error.value"
            :test-id="`${testId}.hide-dialog`"
            @submit="submitHide"
        />
        <ForumBanDialog
            v-if="author"
            v-model:open="banOpen"
            :username="author.username ?? '–'"
            :restricted="author.forum_restricted"
            :restricted-until="author.forum_restricted_until"
            :processing="action.processing.value"
            :error="action.error.value"
            :test-id="`${testId}.ban-dialog`"
            @submit="submitBan"
        />
    </div>
</template>
