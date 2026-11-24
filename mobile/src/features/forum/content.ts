/**
 * The Markdown subset of a forum post as the server answers it (m5.8-contract D5, ForumPostResource `content`): paragraphs and lists
 * (ordered or not, nested) of text spans (bold, italic), links (http/https only) and line breaks. The app never parses Markdown for
 * display and never renders HTML: ForumContent.tsx draws this tree natively, typed by the generated schema.
 *
 * The OpenAPI schema describes two levels of lists and leaves a deeper item `unknown` (a recursive schema), so `blocksOf` reads those
 * through a guard; and a link opens only for an absolute http(s) address (`safeHref`), whatever the server sends.
 */
import type { components } from '@/api/schema';

export type ForumBlock = components['schemas']['ForumPostResource']['content'][number];
export type ForumInline = NonNullable<ForumBlock['children']>[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A block of a list item: what the schema types, or (deeper than it describes) anything shaped like one. */
export function isBlock(value: unknown): value is ForumBlock {
  return isRecord(value) && (value.type === 'paragraph' || value.type === 'list');
}

/** The blocks of one list item, at any depth. */
export function blocksOf(item: readonly unknown[]): ForumBlock[] {
  return item.filter(isBlock);
}

/** Only absolute http(s) addresses open; everything else stays text. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const href = value.trim();
  if (!/^https?:\/\/[^\s/?#]+/i.test(href)) return null;
  if ([...href].some((character) => character.charCodeAt(0) <= 0x20 || character.charCodeAt(0) === 0x7f)) return null;
  return href;
}

function inlineText(nodes: readonly ForumInline[]): string {
  return nodes
    .map((node) => (node.type === 'break' ? ' ' : node.type === 'link' ? (node.children ?? []).map((child) => child.text).join('') || (node.href ?? '') : (node.text ?? '')))
    .join('');
}

/** The tree as one line of plain text: for an excerpt, a quote bar and accessible names. */
export function plainTextOf(blocks: readonly ForumBlock[]): string {
  return blocks
    .map((block) => (block.type === 'paragraph' ? inlineText(block.children ?? []) : (block.items ?? []).map((item) => plainTextOf(blocksOf(item))).join(' ')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first characters of a post, cut at a word: the "Antwort an" quote bar. */
export function excerptOf(blocks: readonly ForumBlock[], max = 90): string {
  const text = plainTextOf(blocks);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
