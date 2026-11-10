/** M2.8 round 2: a FlashList cell's late web layout event for a row that is gone never reaches FlashList. */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { GuardedCell, ListRowCount } from '@/ui/flashListCell';

const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 120 } } };

describe('GuardedCell', () => {
  it('passes the layout of a row that exists, and drops one whose index is past the rows', async () => {
    const onLayout = jest.fn();
    const { rerender } = await render(
      <ListRowCount count={3}>
        <GuardedCell index={2} onLayout={onLayout} testID="cell" />
      </ListRowCount>,
    );
    await fireEvent(screen.getByTestId('cell'), 'layout', layout);
    expect(onLayout).toHaveBeenCalledTimes(1);

    // The chip removal: one row is left, and the old cell's event comes in late.
    await rerender(
      <ListRowCount count={1}>
        <GuardedCell index={2} onLayout={onLayout} testID="cell" />
      </ListRowCount>,
    );
    await fireEvent(screen.getByTestId('cell'), 'layout', layout);
    expect(onLayout).toHaveBeenCalledTimes(1);
  });

  it('outside a ListRowCount it changes nothing', async () => {
    const onLayout = jest.fn();
    await render(<GuardedCell index={9} onLayout={onLayout} testID="cell" />);
    await fireEvent(screen.getByTestId('cell'), 'layout', layout);
    expect(onLayout).toHaveBeenCalledTimes(1);
  });
});
