/** Code review S3: every list built on the shared frame gets the guarded cell (a late web layout event of a gone row is dropped). */
import { render } from '@testing-library/react-native';

import { CollapsingFlashList, GuardedCell, GuardedFlashList } from '@/ui/flashListCell';

const mockSeen: { CellRendererComponent?: unknown }[] = [];
jest.mock('@shopify/flash-list', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const { Component } = jest.requireActual<typeof import('react')>('react');
  // A class, as Reanimated's createAnimatedComponent wants one; it records the props the frame hands on.
  class FlashList extends Component<{ CellRendererComponent?: unknown }> {
    override render() {
      mockSeen.push(this.props);
      return <View />;
    }
  }
  return { FlashList };
});

beforeEach(() => {
  mockSeen.length = 0;
});

describe('the shared list frame', () => {
  const renderItem = () => null;

  it('GuardedFlashList brings the guarded cell', async () => {
    await render(<GuardedFlashList data={[1, 2]} renderItem={renderItem} />);
    expect(mockSeen.at(-1)?.CellRendererComponent).toBe(GuardedCell);
  });

  it('CollapsingFlashList brings it too (MSG-01, DISC-04, SET-16 and every tab root)', async () => {
    await render(<CollapsingFlashList data={[1, 2]} renderItem={renderItem} />);
    expect(mockSeen.at(-1)?.CellRendererComponent).toBe(GuardedCell);
  });

  it('a list that brings its own cell keeps it', async () => {
    const Own = () => null;
    await render(<GuardedFlashList data={[1]} renderItem={renderItem} CellRendererComponent={Own} />);
    expect(mockSeen.at(-1)?.CellRendererComponent).toBe(Own);
  });
});
