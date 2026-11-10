import type { ComponentProps } from 'react';
import type { FlashList } from '@shopify/flash-list';

import { GarageStrip } from '@/features/profile/components/GarageStrip';
import { hydrateThemePreference, space } from '@/theme';

import { flat, renderUi } from '../ui/helpers';

const mockList: { props: Partial<ComponentProps<typeof FlashList>> | null } = { props: null };
jest.mock('@shopify/flash-list', () => ({
  FlashList: (props: Partial<ComponentProps<typeof FlashList>>) => {
    mockList.props = props;
    return null;
  },
}));

beforeAll(hydrateThemePreference);

describe('PROF-01 garage strip', () => {
  it('gives the focus ring of a card room inside the scroller, without moving the strip (DQ-054, ADR-161)', async () => {
    await renderUi(<GarageStrip vehicles={[]} width={390} gutter={20} kind="phone" onOpen={jest.fn()} />);
    // The ring reaches 2 + 4 outside the card, and the scroller clips at its own edge on web.
    expect(flat(mockList.props?.contentContainerStyle)).toMatchObject({ paddingHorizontal: 20, paddingVertical: space[8] });
    expect(flat(mockList.props?.style).marginVertical).toBe(-space[8]);
  });
});
