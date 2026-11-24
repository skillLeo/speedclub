/**
 * Pure rules of the forum screens (M5.8), kept apart from the components for the tests: the filters in the address, which empty state
 * a list shows, the category chips, the composer's validation, the reply tree and what a notification row says.
 */
import {
  FORUM_LIMITS,
  THREAD_SORTS,
  type ForumCategory,
  type ForumPost,
  type ForumThreadSort,
  type ThreadFilters,
} from '@/api/queries/forum';

export function paramText(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function sortOf(value: string | undefined): ForumThreadSort {
  return THREAD_SORTS.includes(value as ForumThreadSort) ? (value as ForumThreadSort) : 'active';
}

const SLUG = /^[a-z0-9-]{1,80}$/;

/** `?category=&sort=&q=` of FOR-01/02 (a foreign slug or sort is ignored, never sent). */
export function filtersFromParams(params: { category?: string | string[]; sort?: string | string[]; q?: string | string[] }): ThreadFilters & { text: string } {
  const category = paramText(params.category);
  const text = (paramText(params.q) ?? '').slice(0, FORUM_LIMITS.queryMax);
  return { category: category && SLUG.test(category) ? category : null, sort: sortOf(paramText(params.sort)), q: null, text };
}

export type ListEmptyKind = 'none' | 'empty' | 'filtered' | 'unanswered';

/**
 * Which empty state a list shows: none while it has rows; "Jede Frage hat schon eine Antwort" for an empty Unbeantwortet without other
 * filters; the filtered state when the reader narrowed it (search, a sub-category, a sort other than Aktiv); otherwise the forum is
 * still empty (the badged sample and "Thema starten").
 */
export function listEmptyKind(count: number, filters: ThreadFilters, baseCategory: string | null = null): ListEmptyKind {
  if (count > 0) return 'none';
  const narrowed = filters.q !== null || (filters.category ?? null) !== baseCategory;
  if (!narrowed && filters.sort === 'unanswered') return 'unanswered';
  if (narrowed || filters.sort !== 'active') return 'filtered';
  return 'empty';
}

export type CategoryChip = { slug: string | null; label: string };

/** "Alle" and the categories in their order (FOR-01: the top level; FOR-02: the children of its category). */
export function categoryChips(categories: readonly Pick<ForumCategory, 'slug' | 'name'>[], allLabel: string): CategoryChip[] {
  return [{ slug: null, label: allLabel }, ...categories.map((category) => ({ slug: category.slug, label: category.name }))];
}

/** The top-level category a slug belongs to (itself or its parent), for the composer and FOR-02's chips. */
export function topCategoryOf(tree: readonly ForumCategory[], slug: string | null): ForumCategory | null {
  if (!slug) return null;
  for (const category of tree) {
    if (category.slug === slug) return category;
    if (category.children.some((child) => child.slug === slug)) return category;
  }
  return null;
}

/** Every category a thread can be filed in, sub-categories under their parent's name. */
export type ComposerCategory = { slug: string; label: string; group: string | null };

export function composerCategories(tree: readonly ForumCategory[]): ComposerCategory[] {
  return tree.flatMap((category): ComposerCategory[] =>
    category.children.length > 0
      ? category.children.map((child) => ({ slug: child.slug, label: child.name, group: category.name }))
      : [{ slug: category.slug, label: category.name, group: null }],
  );
}

// -- Composer (FOR-04)

export type ComposerIssue = 'titleShort' | 'titleLong' | 'categoryMissing' | 'bodyShort' | 'bodyLong' | 'tagsInvalid' | 'tagsTooMany';

/** The server's tag rule (ForumTags::PATTERN): 2–24 lower-case letters, digits or hyphens, starting with a letter or digit. */
const TAG = /^[\p{Ll}\p{N}][\p{Ll}\p{N}-]{1,23}$/u;

/** "Fahrwerk, #fahrwerk, Bremsen" → ["fahrwerk", "bremsen"]: trimmed, lower case, a leading hash dropped, duplicates once. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const tag = raw.trim().replace(/^#+/, '').trim().toLocaleLowerCase('de-DE');
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export function composerIssues(values: { title: string; category: string; body: string; tags: string }): Partial<Record<'title' | 'category' | 'body' | 'tags', ComposerIssue>> {
  const issues: Partial<Record<'title' | 'category' | 'body' | 'tags', ComposerIssue>> = {};
  const title = values.title.trim();
  if (title.length < FORUM_LIMITS.titleMin) issues.title = 'titleShort';
  else if (title.length > FORUM_LIMITS.titleMax) issues.title = 'titleLong';
  if (!values.category) issues.category = 'categoryMissing';
  const body = values.body.trim();
  if (body.length < FORUM_LIMITS.openingMin) issues.body = 'bodyShort';
  else if (body.length > FORUM_LIMITS.openingMax) issues.body = 'bodyLong';
  const tags = parseTags(values.tags);
  if (tags.length > FORUM_LIMITS.tags) issues.tags = 'tagsTooMany';
  else if (tags.some((tag) => !TAG.test(tag))) issues.tags = 'tagsInvalid';
  return issues;
}

/** "Ähnliche Themen" asks once the title has this many characters (and never for the thread being edited). */
export function similarQueryOf(title: string): string | null {
  const text = title.trim().replace(/\s+/g, ' ');
  return text.length >= FORUM_LIMITS.similarMin ? text.slice(0, FORUM_LIMITS.titleMax) : null;
}

// -- Thread (FOR-03)

/**
 * One level of nesting (10 §7.2): an answer to an answer joins the top-level reply. The composer's `parent` is therefore always the
 * top-level reply; the name in "Antwort an @…" is whoever was tapped.
 */
export function replyParentOf(post: Pick<ForumPost, 'id' | 'parent_id'>): string {
  return post.parent_id ?? post.id;
}

/** Whether "Hilfreich" can be pressed: a published, visible reply of someone else (contract §2 "Votes"). */
export function canVote(post: Pick<ForumPost, 'status' | 'deleted' | 'viewer' | 'id'>): boolean {
  return post.status === 'published' && !post.deleted && !post.viewer.is_author && !isLocalPost(post);
}

/** The reply with `id` in the loaded pages, top-level or an answer. */
export function findPost(posts: readonly ForumPost[], id: string): ForumPost | null {
  for (const post of posts) {
    if (post.id === id) return post;
    const answer = post.replies.find((reply) => reply.id === id);
    if (answer) return answer;
  }
  return null;
}

/** The index of the top-level reply that holds `id` (itself or one of its answers), or -1. */
export function topIndexOf(posts: readonly ForumPost[], id: string): number {
  return posts.findIndex((post) => post.id === id || post.replies.some((reply) => reply.id === id));
}

/** SF-6: how many pages of replies a `?post=` (or "Zur Antwort") may read to find its reply: 10 pages of 20, the server's page size. */
export const SEEK_PAGE_CAP = 10;

export type SeekStep = 'show' | 'fetch' | 'wait' | 'stop';

/**
 * SF-6: one step of finding a reply that is not loaded yet (the newest reply of an "oldest first" list sits on the last page): show it
 * once it is loaded, otherwise read the next page while there is one and the cap allows, wait while a page is on its way, else stop.
 */
export function seekStep(state: { found: boolean; hasNext: boolean; fetching: boolean; failed: boolean; pages: number; cap?: number }): SeekStep {
  if (state.found) return 'show';
  if (state.fetching) return 'wait';
  if (state.failed || !state.hasNext || state.pages >= (state.cap ?? SEEK_PAGE_CAP)) return 'stop';
  return 'fetch';
}

/** A reply that exists only on this device until the server answers: it can be neither answered nor voted on (review nit). */
export function isLocalPost(post: Pick<ForumPost, 'id'>): boolean {
  return post.id.startsWith('local-');
}

/** Why staff did not publish the member's own post or thread (pre-moderation reject, `review_reason`): trimmed, null when empty. */
export function reasonText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
