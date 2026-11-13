/**
 * M4.4 design QA round 1 (docs/reports/design-qa/phase-4/2026-11-12-M4.4.md, ADR-431): the rules behind the fixes that are not
 * covered by the component suites already — Verlauf titles from the change (DQ-955), the sticky CTA stacking rule (DQ-958),
 * the desktop lead crop (DQ-963), the BuildSheet row anatomy (DQ-952) and the feed header at a large font (DQ-948).
 */
import { screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import type { BuildUpdate } from '@/api/queries/vehicles';
import { historyMetaLine, historyTitle, partNameText, splitPartValue } from '@/features/vehicle/model';
import { hydrateThemePreference } from '@/theme';
import { BuildSheet } from '@/ui/BuildSheet';
import { MediaCard } from '@/ui/MediaCard';
import { leadAspect, MEDIA_ASPECT } from '@/ui/mediaCardLayout';
import { stickyCtaStacks } from '@/ui/StickyCTABar';

import { R34 } from '../vehicle/fixtures';
import { renderUi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));
const dimensions = useWindowDimensions as jest.Mock;

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

const TITLES = { added: '{name} verbaut', replaced: '{name} statt {before}', changed: '{name} geändert', removed: '{name} ausgebaut' } as const;
const title = (key: keyof typeof TITLES, values: { name: string; before?: string }) =>
  TITLES[key].replace('{name}', values.name).replace('{before}', values.before ?? '');

const update = (patch: Partial<BuildUpdate>, change: Partial<BuildUpdate['changes'][number]> | null): BuildUpdate => {
  const base = R34.updates.find((entry) => entry.changes.length === 1) as BuildUpdate;
  return {
    ...base,
    ...patch,
    changes: change ? [{ ...base.changes[0]!, ...change }] : [],
    changes_count: change ? 1 : 0,
  };
};

/** The title as read: without the word joiner and no-break space that keep names together (DQ-977 a). */
const plain = (text: string) => text.replace(/\u2060/g, '').replace(/\u00A0/g, ' ');

describe('Verlauf titles (DQ-955, DQ-977)', () => {
  it('names the change itself: a replacement with "statt", a new part with "verbaut", a removed one with "ausgebaut"', () => {
    expect(plain(historyTitle(update({ type: 'mod_added' }, { label: 'Bremsen', before: 'Brembo Serie', after: 'AP Racing Radi-CAL · 356 mm' }), title))).toBe(
      'AP Racing Radi-CAL statt Brembo Serie',
    );
    expect(plain(historyTitle(update({ type: 'mod_added' }, { label: 'Fahrwerk', before: null, after: 'KW V3' }), title))).toBe('KW V3 verbaut');
    expect(plain(historyTitle(update({ type: 'mod_removed' }, { label: 'Abgasanlage', before: 'Fujitsubo Legalis R', after: null }), title))).toBe('Fujitsubo Legalis R ausgebaut');
    expect(plain(historyTitle(update({ type: 'mod_changed' }, { label: 'Fahrwerk', before: 'KW V3', after: 'KW V3' }), title))).toBe('KW V3 geändert');
  });

  it('DQ-977: titles carry the product name only, the size goes to the meta line', () => {
    const wheels = update({ type: 'mod_added' }, { label: 'Räder', before: 'Serie 18″', after: 'Volk Racing TE37 Saga 18″ × 9,5J ET22' });
    expect(plain(historyTitle(wheels, title))).toBe('Volk Racing TE37 Saga statt Serie');
    expect(historyMetaLine(wheels)).toMatchObject({ label: 'Räder', diff: '18″ × 9,5J ET22' });
  });

  it('DQ-977: the meta line is the system and the key value, never the change again', () => {
    expect(historyMetaLine(update({ type: 'mod_added' }, { label: 'Bremsen', before: 'Brembo Serie', after: 'AP Racing Radi-CAL · 356 mm' }))).toMatchObject({
      label: 'Bremsen',
      diff: '356 mm',
    });
    expect(historyMetaLine(update({ type: 'mod_added' }, { label: 'Fahrwerk', before: 'Serie', after: 'KW V3 · −35 mm' }))).toMatchObject({ label: 'Fahrwerk', diff: '−35 mm' });
    const removed = historyMetaLine(update({ type: 'mod_removed' }, { label: 'Abgasanlage', before: 'Fujitsubo Legalis R', after: null }));
    expect(removed).toMatchObject({ label: 'Abgasanlage' });
    expect(removed?.diff).toBeUndefined();
    // A generic title keeps the arrow diff under it.
    expect(historyMetaLine(update({ type: 'note', type_label: 'Notiz' }, null))).toBeNull();
  });

  it('DQ-977 (a): a short last word stays with the name before it', () => {
    expect(partNameText('Fujitsubo Legalis R')).toBe('Fujitsubo Legalis\u00A0R');
    expect(splitPartValue('KW V3')).toEqual({ name: 'KW V3', spec: null });
  });

  it('keeps the type label for a note, specs and several changes', () => {
    expect(historyTitle(update({ type: 'note', type_label: 'Notiz' }, null), title)).toBe('Notiz');
    expect(historyTitle(update({ type: 'specs_changed', type_label: 'Daten geändert' }, { after: '500 PS' }), title)).toBe('Daten geändert');
    const many = { ...update({ type: 'mod_added', type_label: 'Modifikationen hinzugefügt' }, { after: 'KW V3' }), changes_count: 3 };
    expect(historyTitle(many, title)).toBe('Modifikationen hinzugefügt');
  });
});

describe('sticky CTA pair (DQ-958)', () => {
  it('stacks when the primary label cannot hold half of a 390 row on one line, and stays side by side when it can', () => {
    expect(stickyCtaStacks('Änderungen speichern', 350, 1)).toBe(true);
    expect(stickyCtaStacks('Weiter', 350, 1)).toBe(false);
    expect(stickyCtaStacks('Weiter', 320, 1)).toBe(false);
    expect(stickyCtaStacks('Veröffentlichen', 350, 2)).toBe(true);
    // DQ-978: a draft action that leaves no half for the primary stacks too, in a narrow column (DEV-01 specimen).
    expect(stickyCtaStacks('Weiter', 270, 1, 'Entwurf speichern')).toBe(true);
    expect(stickyCtaStacks('Weiter', 350, 1, 'Entwurf speichern')).toBe(false);
  });
});

describe('MediaCard lead crop (DQ-963)', () => {
  it('is 4:5 on phones and tablets and 16:9 on the desktop', () => {
    expect(leadAspect(false)).toBe(MEDIA_ASPECT.lead);
    expect(leadAspect(true)).toBe('16:9');
  });
});

describe('BuildSheet row (DQ-952)', () => {
  it('puts the status and legal pills on one line under the values, with the brand caption, at 100 %', async () => {
    await renderUi(
      <BuildSheet
        sections={[
          {
            key: 'exhaust',
            title: 'Abgasanlage',
            icon: 'exhaust',
            count: 1,
            countLabel: '1 Mod',
            mods: [{ key: 'm', icon: 'exhaust', name: 'HKS Super Turbo Muffler', brand: 'HKS', values: 'Ø 115 mm', status: 'Verbaut', legalStatus: 'Eintragungsfrei', onPress: jest.fn(), testID: 'm' }],
          },
        ]}
      />,
    );
    expect(screen.getByText('HKS')).toBeTruthy();
    const status = screen.getByTestId('m.status');
    const legal = screen.getByTestId('m.legalStatus');
    // Both pills share one parent, the pill line under the text.
    expect(status.parent?.parent).toBe(legal.parent?.parent ?? legal.parent);
  });
});

describe('MediaCard feed header (DQ-948)', () => {
  it('lets the name and the meta wrap from a font scale above 1, and keeps one line at 100 %', async () => {
    const card = (
      <MediaCard variant="feed" title="Nissan Skyline GT-R R34" photos={[{ source: 1 }]} owner={{ username: 'speedclub.editorial' }} time="12. Juni 2026" testID="f" />
    );
    await renderUi(card);
    expect(screen.getByTestId('f.title').props.numberOfLines).toBe(1);
    screen.unmount();
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 2 });
    await renderUi(card);
    expect(screen.getByTestId('f.title').props.numberOfLines).toBeUndefined();
  });
});
