/**
 * The Markdown subset of the CMS legal drafts (SET-18), read the way CommonMark with GFM tables reads it on the public
 * pages (App\Support\SafeMarkdown): ATX headings, paragraphs with soft and hard breaks, bullet and numbered lists, tables,
 * strong and emphasis, links, autolinks, and rules. Fenced code and quotes keep their text.
 *
 * Nothing here produces markup. The result is a tree of plain strings that the renderer hands to Text primitives, so HTML
 * in the source stays visible text and never runs. Links keep their raw target; `links.ts` decides whether one may open.
 *
 * Every scan moves forward and gives up after a bounded distance, and the delimiter searches remember where they already
 * failed, so hostile input of any shape stays roughly linear.
 */

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'emphasis'; children: MdInline[] }
  | { type: 'link'; href: string; children: MdInline[] }
  /** "[[Firmenname]]": a gap the draft still has to fill, shown as written and marked. */
  | { type: 'placeholder'; text: string }
  | { type: 'break' };

export type MdHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type MdBlock =
  | { type: 'heading'; level: MdHeadingLevel; children: MdInline[] }
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: MdInline[][] }
  | { type: 'table'; header: MdInline[][]; rows: MdInline[][][] }
  | { type: 'code'; text: string }
  | { type: 'rule' };

/**
 * The heading of a numbered section ("3" finds "§ 3 Inhalte", "3. Inhalte", "3 Inhalte", never "13" or "3.1"), first match;
 * -1 when the text has none.
 */
export function sectionHeadingIndex(blocks: readonly MdBlock[], section: string): number {
  const wanted = section.trim().replace(/^§\s*/, '').replace(/\.$/, '');
  if (!/^[0-9]+[a-z]?$/i.test(wanted)) return -1;
  const pattern = new RegExp(`^(?:§\\s*)?${wanted}(?:\\.(?!\\d)|\\s|\\)|$)`, 'i');
  return blocks.findIndex((block) => block.type === 'heading' && pattern.test(plainText(block.children).trim()));
}

export type MdDocument = {
  /** The opening "# Title", which the screen prints once as its own heading (as the public page does). */
  title: string | null;
  blocks: MdBlock[];
};

/** Far above any legal text (the privacy policy has about 11,000 characters). Anything beyond is cut. */
export const MAX_SOURCE_LENGTH = 200_000;
/** Strong inside a link inside emphasis is as deep as real text goes. */
const MAX_INLINE_DEPTH = 4;
const MAX_PLACEHOLDER_LENGTH = 120;
const MAX_LINK_TEXT_LENGTH = 1000;
const MAX_DESTINATION_LENGTH = 2048;
const MAX_TABLE_COLUMNS = 12;

const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

function isWhitespace(character: string | undefined): boolean {
  return character === undefined || character === ' ' || character === '\t' || character === '\n';
}

function isAlphanumeric(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

/** Text runs merge, so the renderer gets as few nodes as the source allows. */
function pushText(target: MdInline[], text: string): void {
  if (!text) return;
  const last = target[target.length - 1];
  if (last?.type === 'text') last.text += text;
  else target.push({ type: 'text', text });
}

function trailingSpaces(text: string): number {
  let count = 0;
  for (let index = text.length - 1; index >= 0 && text[index] === ' '; index -= 1) count += 1;
  return count;
}

// -- Inline

type LinkMatch = { text: string; href: string; end: number };

/** Positions of the closing bracket for each opening one, found in a single pass with a stack. */
function matchBrackets(source: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const open: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '[') open.push(index);
    else if (character === ']') {
      const start = open.pop();
      if (start !== undefined) pairs.set(start, index);
    }
  }
  return pairs;
}

/** `(destination "title")` after the link text, or null. */
function readDestination(source: string, start: number, state: InlineState): { href: string; end: number } | null {
  if (source[start] !== '(' || state.budget <= 0) return null;
  let index = start + 1;
  while (source[index] === ' ' || source[index] === '\t') index += 1;
  let href = '';
  if (source[index] === '<') {
    const close = nextIndex(source, '>', index + 1, state);
    if (close === -1 || close - index > MAX_DESTINATION_LENGTH) return null;
    href = source.slice(index + 1, close);
    if (href.includes('\n') || href.includes('<')) return null;
    index = close + 1;
  } else {
    let depth = 0;
    const from = index;
    for (; index < source.length; index += 1) {
      const character = source[index];
      state.budget -= 1;
      if (index - from > MAX_DESTINATION_LENGTH || state.budget <= 0) return null;
      if (character === '\\' && index + 1 < source.length) {
        index += 1;
        continue;
      }
      if (isWhitespace(character)) break;
      if (character === '(') depth += 1;
      else if (character === ')') {
        if (depth === 0) break;
        depth -= 1;
      }
    }
    href = source.slice(from, index).replace(/\\(.)/g, '$1');
  }
  while (source[index] === ' ' || source[index] === '\t' || source[index] === '\n') index += 1;
  // An optional title, which the app does not show.
  const quote = source[index];
  if (quote === '"' || quote === "'") {
    const close = nextIndex(source, quote, index + 1, state);
    if (close === -1 || close - index > MAX_LINK_TEXT_LENGTH) return null;
    index = close + 1;
    while (source[index] === ' ' || source[index] === '\t' || source[index] === '\n') index += 1;
  }
  if (source[index] !== ')') return null;
  return { href, end: index + 1 };
}

const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/y;
const AUTOLINK_EMAIL = /<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y;
const BARE_URL = /https?:\/\/[^\s<]{1,2048}/y;
const BARE_EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/y;
/** GFM leaves these at the end of a bare link out of it. */
const TRAILING_PUNCTUATION = /[?!.,:;*_~'"]+$/;

function stickyMatch(pattern: RegExp, source: string, index: number): RegExpExecArray | null {
  pattern.lastIndex = index;
  return pattern.exec(source);
}

/** A bare URL may close with a bracket that is its own, but not with the one around it. */
function trimBareUrl(url: string): string {
  let trimmed = url.replace(TRAILING_PUNCTUATION, '');
  while (trimmed.endsWith(')')) {
    const opens = trimmed.split('(').length - 1;
    const closes = trimmed.split(')').length - 1;
    if (closes <= opens) break;
    trimmed = trimmed.slice(0, -1).replace(TRAILING_PUNCTUATION, '');
  }
  return trimmed;
}

/** Characters after which a bare link may start: GFM's "beginning of a line, whitespace, or * _ ~ (". */
function canStartBareLink(previous: string | undefined): boolean {
  return previous === undefined || isWhitespace(previous) || '*_~("'.includes(previous);
}

type InlineState = {
  brackets: Map<number, number>;
  /** A delimiter search that found nothing from this index finds nothing from any later one either. */
  noCloser: Map<string, number>;
  /** The last answer of `nextIndex` per needle, valid for any start between `from` and the hit. */
  found: Map<string, { from: number; at: number }>;
  /** Characters that link destinations may still read. Real text needs a few hundred; hostile text runs out and stays text. */
  budget: number;
};

/** Total characters link destinations may scan in one paragraph. */
const DESTINATION_BUDGET = 100_000;

/** `source.indexOf(needle, from)`, answered from the last search where it can be: searches mostly move forward. */
function nextIndex(source: string, needle: string, from: number, state: InlineState): number {
  const last = state.found.get(needle);
  if (last && from >= last.from && (last.at === -1 || from <= last.at)) return last.at;
  const at = source.indexOf(needle, from);
  state.found.set(needle, { from, at });
  return at;
}

/** The next run of `delimiter` that can close, from `from` on, or -1. */
function findCloser(source: string, delimiter: string, from: number, state: InlineState): number {
  const failedFrom = state.noCloser.get(delimiter);
  if (failedFrom !== undefined && from >= failedFrom) return -1;
  const character = delimiter[0] ?? '*';
  for (let index = source.indexOf(delimiter, from); index !== -1; index = source.indexOf(delimiter, index + 1)) {
    const before = source[index - 1];
    const after = source[index + delimiter.length];
    if (isWhitespace(before) || before === '\\') continue;
    // A single delimiter does not close inside a double one.
    if (delimiter.length === 1 && (after === character || before === character)) continue;
    if (character === '_' && isAlphanumeric(after)) continue;
    return index;
  }
  state.noCloser.set(delimiter, from);
  return -1;
}

function parseInlineWith(source: string, depth: number, insideLink: boolean, state: InlineState, offset: number, end: number): MdInline[] {
  const out: MdInline[] = [];
  let buffer = '';
  const flush = () => {
    pushText(out, buffer);
    buffer = '';
  };
  let index = offset;

  while (index < end) {
    const character = source[index] ?? '';
    const previous = index > offset ? source[index - 1] : undefined;

    if (character === '\\') {
      const next = source[index + 1];
      if (next === '\n') {
        flush();
        out.push({ type: 'break' });
        index += 2;
        continue;
      }
      if (next !== undefined && index + 1 < end && ASCII_PUNCTUATION.includes(next)) {
        buffer += next;
        index += 2;
        continue;
      }
      buffer += character;
      index += 1;
      continue;
    }

    if (character === '\n') {
      // Two spaces before the line end are a hard break, anything else a soft one, which reads as a space.
      const spaces = trailingSpaces(buffer);
      buffer = buffer.slice(0, buffer.length - spaces);
      if (spaces >= 2) {
        flush();
        out.push({ type: 'break' });
      } else {
        buffer += ' ';
      }
      index += 1;
      while (index < end && (source[index] === ' ' || source[index] === '\t')) index += 1;
      continue;
    }

    if (character === '[' && source[index + 1] === '[') {
      const close = nextIndex(source, ']]', index + 2, state);
      const near = close !== -1 && close + 2 <= end && close - index - 2 <= MAX_PLACEHOLDER_LENGTH;
      const inner = near ? source.slice(index + 2, close) : '';
      if (near && inner.trim() && !/[[\]\n]/.test(inner)) {
        flush();
        out.push({ type: 'placeholder', text: source.slice(index, close + 2) });
        index = close + 2;
        continue;
      }
    }

    if (character === '[' && !insideLink && depth < MAX_INLINE_DEPTH) {
      const close = state.brackets.get(index);
      if (close !== undefined && close < end && close - index <= MAX_LINK_TEXT_LENGTH) {
        const destination = readDestination(source, close + 1, state);
        if (destination && destination.end <= end) {
          const link: LinkMatch = { text: source.slice(index + 1, close), href: destination.href, end: destination.end };
          flush();
          out.push({
            type: 'link',
            href: link.href,
            children: parseInlineWith(source, depth + 1, true, state, index + 1, close),
          });
          index = link.end;
          continue;
        }
      }
    }

    if (character === '<' && !insideLink) {
      const auto = stickyMatch(AUTOLINK, source, index) ?? stickyMatch(AUTOLINK_EMAIL, source, index);
      if (auto?.[1] && index + auto[0].length <= end) {
        const target = auto[1];
        flush();
        out.push({
          type: 'link',
          href: target.includes(':') ? target : `mailto:${target}`,
          children: [{ type: 'text', text: target }],
        });
        index += auto[0].length;
        continue;
      }
    }

    if ((character === '*' || character === '_') && depth < MAX_INLINE_DEPTH) {
      let run = 1;
      while (source[index + run] === character && index + run < end) run += 1;
      const after = source[index + run];
      const opens = !isWhitespace(after) && index + run < end && !(character === '_' && isAlphanumeric(previous));
      if (opens && run >= 2) {
        const delimiter = character + character;
        const closer = findCloser(source, delimiter, index + 2, state);
        if (closer !== -1 && closer + 2 <= end && closer > index + 2) {
          flush();
          out.push({ type: 'strong', children: parseInlineWith(source, depth + 1, insideLink, state, index + 2, closer) });
          index = closer + 2;
          continue;
        }
      } else if (opens && run === 1) {
        const closer = findCloser(source, character, index + 1, state);
        if (closer !== -1 && closer + 1 <= end && closer > index + 1) {
          flush();
          out.push({ type: 'emphasis', children: parseInlineWith(source, depth + 1, insideLink, state, index + 1, closer) });
          index = closer + 1;
          continue;
        }
      }
      buffer += source.slice(index, index + run);
      index += run;
      continue;
    }

    if (!insideLink && (character === 'h' || isAlphanumeric(character)) && canStartBareLink(previous)) {
      const url = character === 'h' ? stickyMatch(BARE_URL, source, index) : null;
      if (url && index + url[0].length <= end) {
        const target = trimBareUrl(url[0]);
        if (target.length > 'https://'.length) {
          flush();
          out.push({ type: 'link', href: target, children: [{ type: 'text', text: target }] });
          index += target.length;
          continue;
        }
      }
      const email = stickyMatch(BARE_EMAIL, source, index);
      if (email && index + email[0].length <= end) {
        const address = email[0].replace(/[.-]+$/, '');
        flush();
        out.push({ type: 'link', href: `mailto:${address}`, children: [{ type: 'text', text: address }] });
        index += address.length;
        continue;
      }
    }

    buffer += character;
    index += 1;
  }
  flush();
  return out;
}

const WORD_JOINER = '\u2060';
/** A short prefix and its hyphen: one letter ("E-Mail"), an abbreviation in capitals ("QR-Code", "GPS-Position"), or a capitalised form of up to three letters ("App-Kennung", "USt-IdNr."). */
const SHORT_PREFIX = /(^|[^\p{L}\p{N}])(\p{L}|\p{Lu}{2,4}|\p{Lu}[\p{Lu}\p{Ll}]{1,2})-(?=\p{L})/gu;

/**
 * 03 §4 and DQ-145/DQ-220: a line never breaks after a short prefix ("QR- / Code", "E- / Mail"). A word joiner after the hyphen keeps
 * the halves together; the glyph stays the same and screen readers skip it. A word with "://" or "@" is an address someone may copy,
 * so it stays whole. Link targets and code keep their text. The public pages apply the same rule (App\Support\SafeMarkdown).
 */
export function joinShortPrefixes(text: string): string {
  if (!text.includes('-')) return text;
  return text.replace(/\S+/g, (word) => (/:\/\/|@/.test(word) ? word : word.replace(SHORT_PREFIX, `$1$2-${WORD_JOINER}`)));
}

const NO_BREAK_SPACE = '\u00A0';
/** "§" or "§§" and the white space before its number ("§ 27a", "§§ 19 und 21"). */
const PARAGRAPH_SIGN = /(§§?)[ \t\r\n]+(?=\p{Nd})/gu;

/**
 * DQ-221, German typesetting: "§" and "§§" stay with their number, so no line ends on "nach §". A no-break space takes the place of
 * the space; it reads and copies as a space. The public pages apply the same rule (App\Support\SafeMarkdown::joinParagraphSigns).
 */
export function joinParagraphSigns(text: string): string {
  return text.includes('§') ? text.replace(PARAGRAPH_SIGN, `$1${NO_BREAK_SPACE}`) : text;
}

function joinInlines(nodes: MdInline[]): MdInline[] {
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'placeholder') node.text = joinParagraphSigns(joinShortPrefixes(node.text));
    else if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'link') joinInlines(node.children);
  }
  return nodes;
}

export function parseInline(source: string): MdInline[] {
  const state: InlineState = { brackets: matchBrackets(source), noCloser: new Map(), found: new Map(), budget: DESTINATION_BUDGET };
  const parsed = joinInlines(parseInlineWith(source, 0, false, state, 0, source.length));
  // A paragraph never starts or ends with the space of a soft break.
  const first = parsed[0];
  if (first?.type === 'text') first.text = first.text.replace(/^[ \t]+/, '');
  const last = parsed[parsed.length - 1];
  if (last?.type === 'text') last.text = last.text.replace(/[ \t]+$/, '');
  return parsed.filter((node) => node.type !== 'text' || node.text !== '');
}

/** The readable text of inline nodes, for titles and accessible names. */
export function plainText(nodes: readonly MdInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'placeholder') return node.text;
      if (node.type === 'break') return ' ';
      return plainText(node.children);
    })
    .join('');
}

// -- Blocks

function indentOf(line: string): number {
  let width = 0;
  for (const character of line) {
    if (character === ' ') width += 1;
    else if (character === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** Leading blanks go; trailing ones stay, because two of them make a hard break. */
function trimLeading(text: string): string {
  let start = 0;
  while (text[start] === ' ' || text[start] === '\t') start += 1;
  return text.slice(start);
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** "## Title ##" → level and text, or null. Read by hand: a regex here could backtrack on a line of spaces. */
function readHeading(line: string): { level: MdHeadingLevel; text: string } | null {
  if (indentOf(line) > 3) return null;
  const trimmed = line.trimStart();
  let level = 0;
  while (trimmed[level] === '#') level += 1;
  if (level < 1 || level > 6) return null;
  const rest = trimmed.slice(level);
  if (rest !== '' && rest[0] !== ' ' && rest[0] !== '\t') return null;
  let text = rest.trim();
  // A closing run of # goes, if a space separates it from the text.
  let cut = text.length;
  while (cut > 0 && text[cut - 1] === '#') cut -= 1;
  if (cut < text.length && (cut === 0 || text[cut - 1] === ' ' || text[cut - 1] === '\t')) text = text.slice(0, cut).trim();
  return { level: level as MdHeadingLevel, text };
}

function isRule(line: string): boolean {
  if (indentOf(line) > 3) return false;
  const compact = line.replace(/[ \t]/g, '');
  return compact.length >= 3 && /^(?:-+|\*+|_+)$/.test(compact);
}

function setextLevel(line: string): 1 | 2 | null {
  if (indentOf(line) > 3) return null;
  const trimmed = line.trim();
  if (/^=+$/.test(trimmed)) return 1;
  if (/^-+$/.test(trimmed)) return 2;
  return null;
}

type ListMarker = { ordered: boolean; marker: string; start: number; content: string; contentIndent: number };

function readListMarker(line: string): ListMarker | null {
  const indent = indentOf(line);
  if (indent > 3) return null;
  const trimmed = line.trimStart();
  const bullet = trimmed[0];
  if ((bullet === '-' || bullet === '*' || bullet === '+') && (trimmed[1] === ' ' || trimmed[1] === '\t' || trimmed.length === 1)) {
    return { ordered: false, marker: bullet, start: 1, content: trimLeading(trimmed.slice(1)), contentIndent: indent + 2 };
  }
  let digits = 0;
  while (digits < 9 && trimmed[digits] !== undefined && trimmed[digits]! >= '0' && trimmed[digits]! <= '9') digits += 1;
  const delimiter = trimmed[digits];
  const space = trimmed[digits + 1];
  if (digits > 0 && (delimiter === '.' || delimiter === ')') && (space === ' ' || space === '\t' || space === undefined)) {
    return {
      ordered: true,
      marker: delimiter,
      start: Number.parseInt(trimmed.slice(0, digits), 10),
      content: trimLeading(trimmed.slice(digits + 1)),
      contentIndent: indent + digits + 2,
    };
  }
  return null;
}

function fenceOf(line: string): string | null {
  if (indentOf(line) > 3) return null;
  const trimmed = line.trimStart();
  const character = trimmed[0];
  if (character !== '`' && character !== '~') return null;
  let length = 0;
  while (trimmed[length] === character) length += 1;
  return length >= 3 ? character.repeat(length) : null;
}

/** The cells of a table row; `\|` is a pipe inside a cell. */
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\' && text[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isTableSeparator(line: string): boolean {
  if (!line.includes('-')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function isTableStart(line: string, next: string | undefined): boolean {
  if (next === undefined || !line.includes('|') || !isTableSeparator(next)) return false;
  return splitTableRow(line).length === splitTableRow(next).length;
}

/** Starts a block of its own, so it ends a paragraph or list item that runs on. */
function startsBlock(line: string, next: string | undefined): boolean {
  return readHeading(line) !== null || isRule(line) || fenceOf(line) !== null || isTableStart(line, next) || /^ {0,3}>/.test(line);
}

function fitColumns(cells: string[], count: number): string[] {
  const fitted = cells.slice(0, count);
  while (fitted.length < count) fitted.push('');
  return fitted;
}

export function parseMarkdown(input: string): MdDocument {
  const source = input.slice(0, MAX_SOURCE_LENGTH).replace(/\r\n?/g, '\n').replace(/\u0000/g, '�');
  const lines = source.split('\n');
  const blocks: MdBlock[] = [];
  let paragraph: string[] | null = null;
  let list: { ordered: boolean; marker: string; start: number; items: string[][]; indent: number } | null = null;
  let blankBefore = false;

  const closeParagraph = () => {
    if (paragraph) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
    paragraph = null;
  };
  const closeList = () => {
    if (list) {
      blocks.push({
        type: 'list',
        ordered: list.ordered,
        start: list.start,
        items: list.items.map((item) => parseInline(item.join('\n'))),
      });
    }
    list = null;
  };
  const closeAll = () => {
    closeParagraph();
    closeList();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const next = lines[index + 1];

    if (isBlank(line)) {
      closeParagraph();
      blankBefore = true;
      continue;
    }

    const fence = fenceOf(line);
    if (fence) {
      closeAll();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith(fence)) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({ type: 'code', text: body.join('\n') });
      blankBefore = false;
      continue;
    }

    if (paragraph && !list) {
      const level = setextLevel(line);
      if (level) {
        blocks.push({ type: 'heading', level, children: parseInline((paragraph as string[]).join('\n')) });
        paragraph = null;
        blankBefore = false;
        continue;
      }
    }

    const heading = readHeading(line);
    if (heading) {
      closeAll();
      blocks.push({ type: 'heading', level: heading.level, children: parseInline(heading.text) });
      blankBefore = false;
      continue;
    }

    if (isRule(line)) {
      closeAll();
      blocks.push({ type: 'rule' });
      blankBefore = false;
      continue;
    }

    if (isTableStart(line, next)) {
      closeAll();
      const header = splitTableRow(line).slice(0, MAX_TABLE_COLUMNS);
      const columns = header.length;
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && !isBlank(lines[index] ?? '') && (lines[index] ?? '').includes('|')) {
        rows.push(fitColumns(splitTableRow(lines[index] ?? ''), columns));
        index += 1;
      }
      index -= 1;
      blocks.push({
        type: 'table',
        header: header.map((cell) => parseInline(cell)),
        rows: rows.map((row) => row.map((cell) => parseInline(cell))),
      });
      blankBefore = false;
      continue;
    }

    const marker = readListMarker(line);
    if (marker) {
      closeParagraph();
      const sameList = list !== null && (list as { ordered: boolean }).ordered === marker.ordered && (list as { marker: string }).marker === marker.marker;
      if (!sameList) {
        closeList();
        list = { ordered: marker.ordered, marker: marker.marker, start: marker.start, items: [], indent: marker.contentIndent };
      }
      list!.items.push([marker.content]);
      list!.indent = marker.contentIndent;
      blankBefore = false;
      continue;
    }

    if (list) {
      const current = list as { items: string[][]; indent: number };
      const item = current.items[current.items.length - 1];
      // Indented text belongs to the item; so does text right under it (a lazy continuation), but not after a blank line.
      const continues = indentOf(line) >= Math.min(current.indent, 4) || (!blankBefore && !startsBlock(line, next));
      if (item && continues) {
        item.push(blankBefore ? `\\\n${trimLeading(line)}` : trimLeading(line));
        blankBefore = false;
        continue;
      }
      closeList();
    }

    const quote = /^ {0,3}> ?/.exec(line);
    const text = quote ? line.slice(quote[0].length) : trimLeading(line);
    if (paragraph) (paragraph as string[]).push(text);
    else paragraph = [text];
    blankBefore = false;
  }
  closeAll();

  const first = blocks[0];
  if (first?.type === 'heading' && first.level === 1) {
    return { title: plainText(first.children).trim() || null, blocks: blocks.slice(1) };
  }
  return { title: null, blocks };
}
