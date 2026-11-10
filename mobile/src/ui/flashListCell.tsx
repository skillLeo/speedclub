import { FlashList, type FlashListProps, type FlashListRef } from '@shopify/flash-list';
import { createContext, use, useLayoutEffect, useRef, type ComponentRef, type ReactNode, type Ref } from 'react';
import { View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';

const RowCount = createContext<{ current: number } | null>(null);

/**
 * The number of rows the FlashList inside holds now, for `GuardedCell`. Put it around the list, with the same `data` length.
 */
export function ListRowCount({ count, children }: { count: number; children: ReactNode }) {
  const current = useRef(count);
  useLayoutEffect(() => {
    current.current = count;
  }, [count]);
  return <RowCount value={current}>{children}</RowCount>;
}

export type GuardedCellProps = ViewProps & { index: number; ref?: Ref<ComponentRef<typeof View>> };

/**
 * `CellRendererComponent` for a FlashList whose rows can get fewer while it is on screen. FlashList v2 sizes each cell from its
 * onLayout. On web that event comes from a ResizeObserver and an asynchronous measure, so it can arrive after the data shrank,
 * still carrying the index of a row that is gone. FlashList then throws "index out of bounds, not enough layouts" from the
 * event (WebKit, DISC-02 after a chip was removed or the grid replaced the cards, M2.8 round 2). This cell drops that late event;
 * every other one passes on unchanged.
 */
export function GuardedCell({ index, onLayout, ref, ...rest }: GuardedCellProps) {
  const count = use(RowCount);
  const guarded = onLayout
    ? (event: LayoutChangeEvent) => {
        if (count === null || index < count.current) onLayout(event);
      }
    : undefined;
  return <View ref={ref} onLayout={guarded} {...rest} />;
}

type ListProps<T> = FlashListProps<T> & { ref?: Ref<FlashListRef<T>> };

/** The shared list frame: the row count for `GuardedCell`, and that cell unless a list brings its own. */
function framed<T>(List: typeof FlashList, { ref, CellRendererComponent, ...props }: ListProps<T>) {
  return (
    <ListRowCount count={props.data?.length ?? 0}>
      <List ref={ref} CellRendererComponent={CellRendererComponent ?? GuardedCell} {...(props as FlashListProps<T>)} />
    </ListRowCount>
  );
}

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList) as unknown as typeof FlashList;

/** FlashList in the shared list frame (M2.8 code review S3): a late web layout event of a row that is gone is dropped. */
export const GuardedFlashList = (<T,>(props: ListProps<T>) => framed(FlashList, props)) as unknown as typeof FlashList;

/** The same, with a Reanimated scroll handler. Same props and generics as FlashList. */
export const CollapsingFlashList = (<T,>(props: ListProps<T>) => framed(AnimatedFlashList, props)) as unknown as typeof FlashList;
