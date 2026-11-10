import { parseMarkdown, sectionHeadingIndex } from '@/features/settings/markdown/parse';

const DOC = parseMarkdown(['# Community-Richtlinien', '', '## § 1 Geltung', 'Text.', '', '## 3. Inhalte', 'Text.', '', '### 3.1 Fotos', '', '## § 13 Schluss'].join('\n'));

describe('SET-18 ?section= (SAFE-01 ground)', () => {
  it('finds the numbered heading in its usual spellings', () => {
    const at = (section: string) => {
      const index = sectionHeadingIndex(DOC.blocks, section);
      const block = DOC.blocks[index];
      return block && block.type === 'heading' ? block.level : null;
    };
    expect(sectionHeadingIndex(DOC.blocks, '1')).toBeGreaterThanOrEqual(0);
    expect(at('3')).toBe(2);
    expect(at('§ 3')).toBe(2);
    expect(at('13')).toBe(2);
  });

  it('never takes a subsection or another number for the section, and ignores what is no number', () => {
    const three = sectionHeadingIndex(DOC.blocks, '3');
    expect(sectionHeadingIndex(DOC.blocks, '13')).not.toBe(three);
    expect(sectionHeadingIndex(DOC.blocks, '2')).toBe(-1);
    expect(sectionHeadingIndex(DOC.blocks, 'x); alert(1')).toBe(-1);
  });
});
