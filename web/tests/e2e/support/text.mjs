// Rendered copy, compared word for word. The app and the Blade pages put a word joiner (U+2060) after a hyphen inside
// names and copy so "GT-R" and "QR-Code" never break at the line end (mobile/src/lib/format.ts keepNameTogether, DQ-047,
// DQ-145, DQ-162); Blade keeps vehicle names together with a nowrap span instead (App\Support\KeepTogether). Where the
// joiner sits is a layout decision, not copy, so these checks remove it from the rendered text and then compare exactly:
// same words, same punctuation, same order. Whitespace is normalised the way toHaveText does it.
import { expect } from '@playwright/test';

export const WORD_JOINER = '\u2060';

/**
 * Text as a reader sees it: without the word joiner, and, like Playwright's toHaveText, without zero-width spaces and
 * soft hyphens, trimmed, with runs of whitespace as one space.
 * @param {string | null | undefined} text
 */
export function readable(text) {
  return (text ?? '').replace(/[\u2060\u200b\u00ad]/g, '').trim().replace(/\s+/g, ' ');
}

/**
 * The readable text of the one element the locator matches, or a note of how many it matched. Like toHaveText, a
 * locator that matches no element or several never passes; the poll keeps asking until it matches exactly one.
 * @param {import('@playwright/test').Locator} locator
 */
async function shownText(locator) {
  const texts = await locator.allTextContents();
  return texts.length === 1 ? readable(texts[0]) : `<${texts.length} elements match ${locator}>`;
}

/**
 * toHaveText, exact, apart from the word joiner: retries until the element's text equals `expected`.
 * @param {import('@playwright/test').Locator} locator
 * @param {string} expected the copy as written, with or without joiners
 * @param {{ message?: string, timeout?: number }} [options]
 */
export async function expectText(locator, expected, { message, timeout } = {}) {
  await expect.poll(() => shownText(locator), { message: message ?? `text of ${locator}`, timeout }).toBe(readable(expected));
}

/**
 * toContainText, apart from the word joiner: retries until the element's text contains `expected` as one piece.
 * @param {import('@playwright/test').Locator} locator
 * @param {string} expected
 * @param {{ message?: string, timeout?: number }} [options]
 */
export async function expectTextContaining(locator, expected, { message, timeout } = {}) {
  await expect.poll(() => shownText(locator), { message: message ?? `text of ${locator}`, timeout }).toContain(readable(expected));
}
