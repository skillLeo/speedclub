/** M3.2 view-as: the Nachrichten tab holds the designed state, and nothing of messaging mounts. */
import { render, screen, within } from '@testing-library/react-native';
import type { TabsDescriptor } from 'expo-router/ui';
import { StyleSheet, Text, View } from 'react-native';

import { setViewAsTab } from '@/api/clientViewAs';
import { renderTabSlot } from '@/features/shell/tabSlotRender';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
jest.mock('@/features/viewAs/ViewAsMessagesScreen', () => {
  const { Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ViewAsMessagesScreen: () => <MockText testID="VIEWAS.messages">nicht verfügbar</MockText> };
});

const descriptor = (name: string) =>
  ({ route: { key: `${name}-key`, name }, options: {}, render: () => <View testID={`${name}.content`} /> }) as unknown as TabsDescriptor;
const shown = { index: 0, isFocused: true, loaded: true, detachInactiveScreens: false };

afterEach(() => setViewAsTab('off'));

it('a normal tab renders the inbox', async () => {
  await render(<>{renderTabSlot(descriptor('messages'), shown)}</>);
  expect(screen.getByTestId('messages.content')).toBeTruthy();
});

it('a view-as tab renders the "nicht verfügbar" state instead, and leaves the other tabs alone', async () => {
  setViewAsTab('active', '41|token');
  await render(
    <>
      {renderTabSlot(descriptor('messages'), shown)}
      {renderTabSlot(descriptor('garage'), shown)}
      <Text>x</Text>
    </>,
  );
  expect(screen.getByTestId('VIEWAS.messages')).toBeTruthy();
  expect(screen.queryByTestId('messages.content')).toBeNull();
  expect(screen.getByTestId('garage.content')).toBeTruthy();
});

it('the "nicht verfügbar" state fills its pane out of the flow, as a stack screen does, so its ScrollView is bounded (VIEWAS-MSG fs2)', async () => {
  setViewAsTab('active', '41|token');
  await render(<>{renderTabSlot(descriptor('messages'), shown)}</>);
  const fill = screen.getByTestId('shell.tab.standalone');
  // TabSlot's container grows with whatever is in its flow (flexShrink 0, flexBasis auto): in the flow, the 200 % state grew it past the
  // window, and the root clipped it under the tab bar instead of the state scrolling.
  expect(StyleSheet.flatten(fill.props.style)).toMatchObject({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 });
  expect(within(fill).getByTestId('VIEWAS.messages')).toBeTruthy();
  expect(screen.getByTestId('shell.tab.messages')).toBeTruthy();
});

it('a normal tab keeps its stack as it is, already out of the flow', async () => {
  await render(<>{renderTabSlot(descriptor('messages'), shown)}</>);
  expect(screen.queryByTestId('shell.tab.standalone')).toBeNull();
});
