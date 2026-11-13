/** M4.4 Badge (09 §5) and the app side of M4.2 (09 §8.19): Beispiel / Editorial wherever sample content renders. */
import { screen } from '@testing-library/react-native';

import { ProfileStats } from '@/features/profile/components/ProfileStats';
import { hydrateThemePreference, themes } from '@/theme';
import { Badge, GridTile, MemberRow, OwnerRow, SampleBadges, sampleBadgeKinds, VehicleCard } from '@/ui';
import { autoIconGroups, autoIcons, autoIconsWithFill } from '@/ui/icons/auto';
import { imagePlaceholder } from '@/ui/imagePlaceholder';
import { BUILD_REACTION_GLYPHS } from '@/ui/motion/kit';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

const PHOTO = { source: 1, blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' };

describe('Badge', () => {
  it.each([
    ['sample', 'Beispiel'],
    ['editorial', 'Editorial'],
    ['verified', 'Verifiziert'],
    ['business', 'Betrieb'],
    ['founding', 'Gründungsmitglied'],
    ['dyno', 'Prüfstand'],
  ] as const)('labels %s in sentence case', async (kind, label) => {
    await renderUi(<Badge kind={kind} testID="t.badge" />);
    expect(screen.getByTestId('t.badge')).toHaveTextContent(label);
  });

  it('is 20 high, radius 4, on surface-3 and never red', async () => {
    await renderUi(<Badge kind="sample" testID="t.badge" />);
    const style = flat(screen.getByTestId('t.badge').props.style);
    expect(style.minHeight).toBe(20);
    expect(style.borderRadius).toBe(4);
    expect(style.backgroundColor).toBe(themes.carbon.color.bg.overlay);
    expect([themes.carbon.color.accent.fill, themes.carbon.color.accent.fg]).not.toContain(style.backgroundColor);
  });

  it('takes the photo chip ground on a photo', async () => {
    await renderUi(<Badge kind="sample" tone="onPhoto" testID="t.badge" />);
    expect(flat(screen.getByTestId('t.badge').props.style).backgroundColor).toBe(themes.carbon.color.onPhoto.chipBg);
  });
});

describe('sample flags (09 §8.19)', () => {
  it('maps the API flags to the badges in reading order', () => {
    expect(sampleBadgeKinds({ is_sample: false, is_editorial: false })).toEqual([]);
    expect(sampleBadgeKinds({ is_sample: true })).toEqual(['sample']);
    expect(sampleBadgeKinds({ is_sample: true, is_editorial: true })).toEqual(['editorial', 'sample']);
    expect(sampleBadgeKinds(null)).toEqual([]);
  });

  it('draws nothing for real content', async () => {
    await renderUi(<SampleBadges flags={{ is_sample: false, is_editorial: false }} testID="t.flags" />);
    expect(screen.queryByTestId('t.flags')).toBeNull();
  });

  it('badges a sample build on the card photo and names it to screen readers', async () => {
    await renderUi(<VehicleCard title="BMW M3 E46" photo={PHOTO} sample={{ is_sample: true }} onPress={jest.fn()} testID="t.card" />);
    expect(screen.getByTestId('t.card.sample.sample')).toHaveTextContent('Beispiel');
    expect(screen.getByTestId('t.card.body').props.accessibilityLabel).toMatch(/^Beispiel, BMW M3 E46/);
  });

  it('keeps a real build without a badge', async () => {
    await renderUi(<VehicleCard title="BMW M3 E46" photo={PHOTO} sample={{ is_sample: false }} onPress={jest.fn()} testID="t.card" />);
    expect(screen.queryByTestId('t.card.sample')).toBeNull();
  });

  it('badges the result tile, the member row and the owner row', async () => {
    await renderUi(
      <>
        <GridTile title="Porsche 911 GT3 (992)" photo={PHOTO} sample={{ is_sample: true }} onPress={jest.fn()} testID="t.tile" />
        <MemberRow name="SPEED CLUB Editorial" sample={{ is_sample: true, is_editorial: true }} onPress={jest.fn()} testID="t.member" />
        <OwnerRow name="SPEED CLUB Editorial" sample={{ is_editorial: true }} testID="t.owner" />
      </>,
    );
    expect(screen.getByTestId('t.tile.sample.sample')).toBeTruthy();
    expect(screen.getByTestId('t.member.sample.editorial')).toHaveTextContent('Editorial');
    expect(screen.getByTestId('t.member.sample.sample')).toHaveTextContent('Beispiel');
    expect(screen.getByTestId('t.owner.sample.editorial')).toBeTruthy();
  });
});

describe('hidden counts on samples', () => {
  it('leaves a null count out instead of drawing 0', async () => {
    await renderUi(<ProfileStats stats={{ vehicles: 3, followers: null, following: null }} testID="t.stats" />);
    expect(screen.getByTestId('t.stats')).toHaveTextContent(/^3\sFahrzeuge$/);
    expect(screen.getByTestId('t.stats')).not.toHaveTextContent(/Follower|0/);
  });

  it('draws no stats line when every count is hidden', async () => {
    await renderUi(<ProfileStats stats={{ vehicles: null, followers: null, following: null }} testID="t.stats" />);
    expect(screen.queryByTestId('t.stats')).toBeNull();
  });
});

describe('thumbhash placeholder (09 §4.6)', () => {
  it('prefers the thumbhash and falls back to the blurhash', () => {
    expect(imagePlaceholder(PHOTO.blurhash, 'cover', '1QcSHQRnh493V4dIh4eXh1h4kJUI')).toEqual({ placeholder: { thumbhash: '1QcSHQRnh493V4dIh4eXh1h4kJUI' } });
    expect(imagePlaceholder(PHOTO.blurhash, 'cover', null)).toEqual({ placeholder: { blurhash: PHOTO.blurhash } });
  });
});

describe('glyph set 2.0 (App. C)', () => {
  it('has the 49 glyphs in three groups, every one generated', () => {
    const grouped = [...autoIconGroups.systems, ...autoIconGroups.domain, ...autoIconGroups.reactions];
    expect(grouped).toHaveLength(49);
    expect(new Set(grouped)).toEqual(new Set(Object.keys(autoIcons)));
    expect(autoIconGroups.reactions).toEqual(['strong', 'clean', 'low', 'loud']);
  });

  it('gives the reactions a fill for the chosen state', () => {
    for (const glyph of Object.values(BUILD_REACTION_GLYPHS)) expect(autoIconsWithFill).toContain(glyph);
  });
});
