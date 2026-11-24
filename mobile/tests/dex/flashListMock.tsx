/** FlashList as a plain list for the Dex screen tests: every row renders (`jest.mock('@shopify/flash-list', () => jest.requireActual('./flashListMock'))`). */
import { createElement, forwardRef, Fragment, useImperativeHandle, type ReactNode } from 'react';

type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown) => string;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
};

export const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
  useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), getScrollableNode: () => null }));
  const { data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent, ListFooterComponent } = props;
  const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
  return createElement(Fragment, null, ListHeaderComponent, data.length === 0 ? ListEmptyComponent : items, ListFooterComponent);
});
