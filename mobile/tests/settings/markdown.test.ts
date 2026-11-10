import { joinParagraphSigns, MAX_SOURCE_LENGTH, parseInline, parseMarkdown, plainText, splitTableRow, type MdBlock, type MdInline } from '@/features/settings/markdown/parse';

const text = (value: string): MdInline => ({ type: 'text', text: value });

function blocksOf(source: string): MdBlock[] {
  return parseMarkdown(source).blocks;
}

/** Every href anywhere in the tree. */
function hrefs(nodes: readonly MdInline[]): string[] {
  return nodes.flatMap((node) => (node.type === 'link' ? [node.href, ...hrefs(node.children)] : 'children' in node ? hrefs(node.children) : []));
}

describe('parseMarkdown: the subset of the legal drafts', () => {
  it('takes the opening "# Title" as the title, as the public page does', () => {
    const doc = parseMarkdown('# Impressum\n\n## Anbieter\n\nAngaben nach § 5 DDG:');
    expect(doc.title).toBe('Impressum');
    expect(doc.blocks[0]).toEqual({ type: 'heading', level: 2, children: [text('Anbieter')] });
    expect(doc.blocks[1]).toEqual({ type: 'paragraph', children: [text('Angaben nach §\u00A05 DDG:')] });
  });

  it('keeps the body whole when it does not open with a level-1 heading', () => {
    const doc = parseMarkdown('Vorwort\n\n# Später');
    expect(doc.title).toBeNull();
    expect(doc.blocks).toHaveLength(2);
  });

  it('joins soft breaks with a space and keeps hard breaks (two spaces or a backslash)', () => {
    expect(blocksOf('a\nb')[0]).toEqual({ type: 'paragraph', children: [text('a b')] });
    expect(blocksOf('a  \nb')[0]).toEqual({ type: 'paragraph', children: [text('a'), { type: 'break' }, text('b')] });
    expect(blocksOf('a\\\nb')[0]).toEqual({ type: 'paragraph', children: [text('a'), { type: 'break' }, text('b')] });
  });

  it('reads bullet and numbered lists, with continuation lines', () => {
    const [bullets, numbers] = blocksOf('- eins\n- zwei\n  weiter\n\n3. drei\n4. vier');
    expect(bullets).toEqual({ type: 'list', ordered: false, start: 1, items: [[text('eins')], [text('zwei weiter')]] });
    expect(numbers).toEqual({ type: 'list', ordered: true, start: 3, items: [[text('drei')], [text('vier')]] });
  });

  it('reads a GFM table and pads short rows', () => {
    const [table] = blocksOf('| Software | Lizenz |\n|---|---|\n| Laravel | MIT |\n| Expo |');
    expect(table).toEqual({
      type: 'table',
      header: [[text('Software')], [text('Lizenz')]],
      rows: [
        [[text('Laravel')], [text('MIT')]],
        [[text('Expo')], []],
      ],
    });
  });

  it('splits table cells on unescaped pipes only', () => {
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
  });

  it('reads strong, emphasis, links, autolinks and bare links', () => {
    expect(parseInline('**6 Monaten** und *kurz*')).toEqual([
      { type: 'strong', children: [text('6 Monaten')] },
      text(' und '),
      { type: 'emphasis', children: [text('kurz')] },
    ]);
    expect(hrefs(parseInline('[AGB](/settings/legal/terms "AGB") <https://speedclub.de> mail an kontakt@speedclub.de.'))).toEqual([
      '/settings/legal/terms',
      'https://speedclub.de',
      'mailto:kontakt@speedclub.de',
    ]);
    expect(hrefs(parseInline('Siehe https://speedclub.de/impressum).'))).toEqual(['https://speedclub.de/impressum']);
  });

  it('keeps placeholders of the drafts whole and marked', () => {
    expect(parseInline('[[Firmenname]] [[Rechtsform]]')).toEqual([
      { type: 'placeholder', text: '[[Firmenname]]' },
      text(' '),
      { type: 'placeholder', text: '[[Rechtsform]]' },
    ]);
  });

  it('keeps a short prefix with its word, never an address or a link target (DQ-220)', () => {
    const joined = (value: string) => value.replace(/-/g, '-\u2060');
    expect(parseInline('QR-Code, E-Mail, KI-Anbieter, GPS-Position, App-Kennung, USt-IdNr., HU/AU-Monat')).toEqual([
      text(joined('QR-Code, E-Mail, KI-Anbieter, GPS-Position, App-Kennung, USt-IdNr., HU/AU-Monat')),
    ]);
    expect(parseInline('Kontakt-E-Mail und [[Melde-E-Mail]]')).toEqual([
      text('Kontakt-E-\u2060Mail und '),
      { type: 'placeholder', text: '[[Melde-E-\u2060Mail]]' },
    ]);
    // Longer words, words that only end in capitals and figures keep their plain hyphen, and so does an existing joiner.
    expect(parseInline('Zwei-Faktor-Anmeldung, two-factor, 4A-GE, QR-\u2060Code')).toEqual([text('Zwei-Faktor-Anmeldung, two-factor, 4A-GE, QR-\u2060Code')]);
    const [mail, web] = parseInline('<x@e-mail.de> und https://e-mail.de/E-Mail').filter((node) => node.type === 'link');
    expect(mail).toEqual({ type: 'link', href: 'mailto:x@e-mail.de', children: [text('x@e-mail.de')] });
    expect(web).toEqual({ type: 'link', href: 'https://e-mail.de/E-Mail', children: [text('https://e-mail.de/E-Mail')] });
    // Deep inside an address too, where the character before the prefix is an ordinary hyphen.
    const [deep] = parseInline('https://speedclub.de/foo-a-b').filter((node) => node.type === 'link');
    expect(deep).toEqual({ type: 'link', href: 'https://speedclub.de/foo-a-b', children: [text('https://speedclub.de/foo-a-b')] });
    expect(blocksOf('```\nE-Mail\n```')[0]).toEqual({ type: 'code', text: 'E-Mail' });
  });

  it('leaves intraword underscores and escaped delimiters alone', () => {
    expect(parseInline('snake_case_name und \\*kein\\* Stern')).toEqual([text('snake_case_name und *kein* Stern')]);
  });

  it('turns setext underlines into headings and other dashes into rules', () => {
    expect(blocksOf('Titel\n---')[0]).toEqual({ type: 'heading', level: 2, children: [text('Titel')] });
    expect(blocksOf('---')[0]).toEqual({ type: 'rule' });
  });

  it('reads plain text of nested nodes for names', () => {
    expect(plainText(parseInline('**Konto** [löschen](/x) [[Name]]'))).toBe('Konto löschen [[Name]]');
  });
});

describe('parseMarkdown: hostile input', () => {
  it('never produces markup: HTML stays text', () => {
    const [paragraph] = blocksOf('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>fett</b>');
    expect(paragraph).toEqual({ type: 'paragraph', children: [text('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>fett</b>')] });
  });

  it('keeps any link target as raw data for the link check, including script URLs', () => {
    expect(hrefs(parseInline('[klick](javascript:alert(1)) [x](data:text/html,<b>) <vbscript:msgbox>'))).toEqual([
      'javascript:alert(1)',
      'data:text/html,<b>',
      'vbscript:msgbox',
    ]);
  });

  it('does not nest links, and an unclosed link is text', () => {
    const nested = parseInline('[a [b](/x) c](/y)');
    expect(nested.filter((node) => node.type === 'link')).toHaveLength(1);
    expect(parseInline('[offen](/kein-ende')).toEqual([text('[offen](/kein-ende')]);
  });

  it('survives unbalanced delimiters, NUL bytes and lone brackets', () => {
    expect(() => parseMarkdown('**a *b __c [d ](e "f ``` \u0000 |---| [[x')).not.toThrow();
    expect(JSON.stringify(parseMarkdown('a\u0000b'))).not.toContain('\u0000');
  });

  it('caps the source length', () => {
    const doc = parseMarkdown('a'.repeat(MAX_SOURCE_LENGTH + 5000));
    const paragraph = doc.blocks[0];
    expect(paragraph?.type === 'paragraph' && plainText(paragraph.children).length).toBe(MAX_SOURCE_LENGTH);
  });

  it.each([
    ['asterisks', '*'.repeat(100_000)],
    ['brackets', '['.repeat(100_000)],
    ['link openers', '[a]('.repeat(40_000)],
    ['angle links', '[a](<'.repeat(30_000)],
    ['placeholders', `${'[['.repeat(50_000)}]]`],
    ['titles', '[a](b "'.repeat(30_000)],
    ['mixed', '**a _b [c](d '.repeat(15_000)],
    ['emails', 'a@b.'.repeat(30_000)],
    ['urls', 'https://'.repeat(20_000)],
    ['heading spaces', `#${' '.repeat(100_000)}x`],
    ['table rows', `|a|b|\n|-|-|\n${'|x|y|\n'.repeat(20_000)}`],
    ['list lines', '- a\n  b\n'.repeat(20_000)],
  ])('stays fast on %s', (_name, source) => {
    const started = performance.now();
    parseMarkdown(source);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('joinParagraphSigns (DQ-221)', () => {
  const NBSP = '\u00A0';

  it('keeps "§" and "§§" with their number', () => {
    expect(joinParagraphSigns('nach § 27a UStG')).toBe(`nach §${NBSP}27a UStG`);
    expect(joinParagraphSigns('(§ 315d StGB)')).toBe(`(§${NBSP}315d StGB)`);
    expect(joinParagraphSigns('nach §§ 19 und 21')).toBe(`nach §§${NBSP}19 und 21`);
  });

  it('leaves a sign without a number alone, and text without one untouched', () => {
    expect(joinParagraphSigns('das Zeichen § allein')).toBe('das Zeichen § allein');
    expect(joinParagraphSigns('Art. 6 DSGVO')).toBe('Art. 6 DSGVO');
  });

  it('reaches text inside strong, links and placeholders, and never a link target', () => {
    const [strong] = parseInline('**nach § 5 DDG**');
    expect(strong).toEqual({ type: 'strong', children: [{ type: 'text', text: `nach §${NBSP}5 DDG` }] });
    const [link] = parseInline('[§ 5 DDG](https://example.com/ddg)');
    expect(link).toEqual({ type: 'link', href: 'https://example.com/ddg', children: [{ type: 'text', text: `§${NBSP}5 DDG` }] });
    expect(parseInline('[[§ 7 offen]]')).toEqual([{ type: 'placeholder', text: `[[§${NBSP}7 offen]]` }]);
  });

  it('reads the same as a heading title and in a table cell', () => {
    const doc = parseMarkdown('# Nach § 5\n\n| Grundlage | Frist |\n| --- | --- |\n| § 257 HGB | 6 Jahre |');
    expect(doc.title).toBe(`Nach §${NBSP}5`);
    const table = doc.blocks[0];
    expect(table?.type === 'table' ? table.rows[0]?.[0] : null).toEqual([{ type: 'text', text: `§${NBSP}257 HGB` }]);
  });
});
