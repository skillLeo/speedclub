import { usePage } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import type { Tone } from '../../Components/ui';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../composables/recentPassword';
import { useDecisionWrites } from '../../composables/splitQueue';
import { formatNumber } from '../../lib/format';
import { now } from '../../lib/qa';
import { routeOr } from '../../lib/routes';

/** Shapes and helpers of ADM-68 Forum-Moderation and ADM-69 Forum-Kategorien (m5.8-contract §6; server: ForumAdminRecord). */
export type ForumTab = 'pending' | 'reported' | 'threads' | 'removed';
export type ThreadStatus = 'pending' | 'published' | 'rejected' | 'removed' | 'merged';
export type PostStatus = 'pending' | 'published' | 'rejected' | 'removed';
export type PostAction = 'approve' | 'reject' | 'hide';
export type ThreadTool = 'pin' | 'unpin' | 'lock' | 'unlock' | 'move' | 'merge' | 'solution';
/** The tools that open ThreadToolDialog. */
export type ToolMode = 'move' | 'merge' | 'solution';

export interface CategoryRef {
    id: number;
    name: string;
}

export interface PendingRow {
    id: string;
    kind: 'thread' | 'reply';
    thread: { id: string; title: string; category: CategoryRef | null };
    author: { id: string; username: string | null; joined_at: string | null; email_verified: boolean; reason: 'new_account' | 'unverified' | null } | null;
    excerpt: string;
    photos_count: number;
    created_at: string | null;
    version: string;
}

export interface ReportedRow {
    case_id: string;
    post_id: string;
    kind: 'thread' | 'reply';
    thread: { id: string; title: string } | null;
    reports: number;
    priority: number;
    status: 'new' | 'in_review' | 'decided' | 'closed';
    opened_at: string | null;
}

export interface ThreadRow {
    id: string;
    title: string;
    status: ThreadStatus;
    category: CategoryRef | null;
    author: { id: string; username: string | null } | null;
    replies_count: number;
    is_pinned: boolean;
    is_locked: boolean;
    is_solved: boolean;
    is_sample: boolean;
    last_activity_at: string | null;
    updated_at: string | null;
    version: string | null;
}

/** One row type for the table: the reported rows get `id` = their post (the pane opens the post's thread). */
export type QueueRow = (PendingRow & { tab: 'pending' }) | (ReportedRow & { id: string; tab: 'reported' }) | (ThreadRow & { tab: 'threads' });

export interface ForumPostItem {
    id: string;
    parent_id: string | null;
    is_opening: boolean;
    status: PostStatus;
    author: { id: string; username: string | null } | null;
    body: string;
    /** Sanitised by the server (ForumMarkdown: the Markdown subset, links rel="nofollow ugc noopener noreferrer"). */
    body_html: string;
    helpful_count: number;
    created_at: string | null;
    edited_at: string | null;
    deleted: boolean;
    version: string;
}

export interface ForumCaseItem {
    id: string;
    post_id: string;
    status: ReportedRow['status'];
    open: boolean;
    reports: number;
    opened_at: string | null;
}

export interface ForumSelected {
    thread: {
        id: string;
        title: string;
        status: ThreadStatus;
        category: CategoryRef | null;
        tags: string[];
        is_pinned: boolean;
        is_locked: boolean;
        solved_post_id: string | null;
        merged_into_id: string | null;
        is_sample: boolean;
        version: string | null;
        vehicle: { id: string; title: string | null } | null;
        author: { id: string; username: string | null; joined_at: string | null; email_verified: boolean; forum_restricted_until: string | null; forum_restricted: boolean } | null;
    };
    posts: ForumPostItem[];
    photos: { id: string; url_320: string | null; url_640: string | null; width: number | null; height: number | null }[];
    cases: ForumCaseItem[];
    item: string | null;
    can: { decide: boolean; ban: boolean };
}

export interface DecidedPost {
    id: string;
    thread_id: string;
    outcome: 'approved' | 'rejected';
    version: string;
}

export interface CategoryOption {
    id: number;
    name: string;
    parent_id: number | null;
}

export interface ForumCategoryRow {
    id: number;
    slug: string;
    kind: 'standard' | 'make' | 'region';
    name_de: string;
    name_en: string;
    description_de: string | null;
    description_en: string | null;
    icon: string | null;
    sort: number;
    is_active: boolean;
    make: { id: number; name: string } | null;
    bundesland: string | null;
    threads_count: number;
    children?: ForumCategoryRow[];
}

export const threadTones: Record<ThreadStatus, Tone> = { pending: 'warning', published: 'success', rejected: 'danger', removed: 'danger', merged: 'neutral' };
export const postTones: Record<PostStatus, Tone> = { pending: 'warning', published: 'success', rejected: 'danger', removed: 'danger' };
export const caseTones: Record<ReportedRow['status'], Tone> = { new: 'info', in_review: 'warning', decided: 'neutral', closed: 'neutral' };

/** "Technik & Tuning › Fahrwerk": a sub-category with its parent, for pickers and captions. */
export function categoryLabel(categories: CategoryOption[], id: number | null | undefined): string {
    const category = categories.find((c) => c.id === id);
    if (!category) return '–';
    const parent = category.parent_id === null ? null : categories.find((c) => c.id === category.parent_id);
    return parent ? `${parent.name} › ${category.name}` : category.name;
}

/** Category options for a picker: parents first, each followed by its children ("Parent › Child"). */
export function categoryOptions(categories: CategoryOption[], exclude: number | null = null): { value: string; label: string }[] {
    const parents = categories.filter((c) => c.parent_id === null);
    return parents.flatMap((parent) => [parent, ...categories.filter((c) => c.parent_id === parent.id)]).filter((c) => c.id !== exclude).map((c) => ({ value: String(c.id), label: categoryLabel(categories, c.id) }));
}

/** Minutes since an ISO time, from the admin clock (`?qaNow=` keeps captures stable). */
export function minutesSince(iso: string | null): number | null {
    if (iso === null) return null;
    const at = Date.parse(iso);
    return Number.isNaN(at) ? null : Math.max(0, Math.floor((now().getTime() - at) / 60_000));
}

/** "45 Min.", "5 Std.", "3 Tg.": the waiting time of a pre-moderated post. */
export function waitingText(minutes: number | null): string {
    if (minutes === null) return '–';
    if (minutes < 60) return trans('forum.waiting.minutes', { count: formatNumber(minutes) });
    if (minutes < 48 * 60) return trans('forum.waiting.hours', { count: formatNumber(Math.floor(minutes / 60)) });
    return trans('forum.waiting.days', { count: formatNumber(Math.floor(minutes / (24 * 60))) });
}

/** Pre-moderation SLA: a post that waits longer than a day shows the timer as a warning (06 §3). */
export const overdue = (minutes: number | null): boolean => minutes !== null && minutes >= 24 * 60;

/** A ULID from a pasted admin link (`?thread=`), a member link (`/forum/<id>`) or the id itself; null when there is none. */
export function threadIdFrom(text: string): string | null {
    const match = /(?:^|[^0-9A-Za-z])([0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26})(?![0-9A-Za-z])/.exec(` ${text.trim()}`);
    return match ? match[1]!.toLowerCase() : null;
}

export const queueUrl = (): string => routeOr('admin.forum.queue', '/admin/forum');
export const categoriesUrl = (): string => routeOr('admin.forum.categories.index', '/admin/forum/categories');
export const postActionUrl = (id: string, action: PostAction): string => routeOr(`admin.forum.posts.${action}`, `/admin/forum/posts/${id}/${action}`, { post: id });
export const threadToolUrl = (id: string, tool: ThreadTool): string => routeOr(`admin.forum.threads.${tool}`, `/admin/forum/threads/${id}/${tool}`, { thread: id });
export const banUrl = (member: string): string => routeOr('admin.forum.members.ban', `/admin/forum/members/${member}/ban`, { member });
export const categoryUrl = (action: 'store' | 'order' | 'sync'): string => routeOr(`admin.forum.categories.${action}`, `/admin/forum/categories${action === 'store' ? '' : `/${action}`}`);
export const categoryRecordUrl = (action: 'update' | 'destroy', id: number): string => routeOr(`admin.forum.categories.${action}`, `/admin/forum/categories/${id}`, { category: id });
export const caseHref = (id: string): string => routeOr('admin.moderation.cases.show', `/admin/moderation/cases/${id}`, { case: id });
export const memberHref = (id: string): string => routeOr('admin.members.show', `/admin/members/${id}`, { member: id });

/**
 * Pre-moderation approve/reject with the version the staff member saw (ADR-439), from the shared SplitQueue composable. These routes need
 * a recent password (⚿): a stale confirmation asks first, so the decision's own callbacks (auto-advance) run after it.
 */
export function useForumDecisions() {
    const writes = useDecisionWrites<'approve' | 'reject'>('forum', postActionUrl);
    const page = usePage();
    function post(item: { id: string; version: string | null }, action: 'approve' | 'reject', data: { reason?: string | null } = {}, onSuccess?: () => void): void {
        const go = (): void => writes.post(item, action, data, onSuccess);
        if (passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) go();
        else confirmPasswordFirst(go);
    }
    return { ...writes, post };
}
