/**
 * DQ-922: `numberOfLines` keeps its single line on the member web. The Text primitive gives a truncated text no wrap style of
 * its own, so react-native-web's `white-space: nowrap` (single line) or line clamp decides, while the same role without
 * `numberOfLines` keeps the running-text wrapping. A display title keeps its balanced lines.
 */
import { screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { hydrateThemePreference } from '@/theme';
import { DisplayTitle } from '@/ui/DisplayTitle';
import { Text } from '@/ui/Text';

import { flat, renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false, isIOS: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
jest.mock('expo-haptics', () => ({}));

const originalOS = Platform.OS;

beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'web';
});
afterEach(() => {
  Platform.OS = originalOS;
});

type Css = Record<string, unknown>;
const PREVIEW = 'Hast du die Felgen schon montiert? Ich hätte noch Distanzscheiben für die Hinterachse.';

it('a callout with numberOfLines={1} sets no wrap style and no text-wrap shorthand', async () => {
  await renderUi(
    <Text variant="callout" numberOfLines={1} testID="preview">
      {PREVIEW}
    </Text>,
  );
  const style = flat(screen.getByTestId('preview').props.style) as Css;
  expect(style.textWrap).toBeUndefined();
  expect(style.textWrapStyle).toBeUndefined();
  expect(style.whiteSpace).toBeUndefined();
  // The full text stays available to assistive technology.
  expect(screen.getByTestId('preview').props['aria-label']).toBe(PREVIEW);
});

it('the same callout without numberOfLines wraps pretty through the longhand', async () => {
  await renderUi(
    <Text variant="callout" testID="note">
      {PREVIEW}
    </Text>,
  );
  const style = flat(screen.getByTestId('note').props.style) as Css;
  expect(style.textWrapStyle).toBe('pretty');
  expect(style.textWrap).toBeUndefined();
});

it('a display title still balances its lines', async () => {
  await renderUi(
    <DisplayTitle testID="title" placement="page">
      Nissan Skyline GT-R R34
    </DisplayTitle>,
  );
  const style = flat(screen.getByTestId('title').props.style) as Css;
  expect(style.textWrapStyle).toBe('balance');
  expect(style.textWrap).toBeUndefined();
});

it('DQ-943: a clamp of two or more lines keeps the running wrap, so it breaks like its unclamped probe', async () => {
  await renderUi(
    <>
      <Text variant="body" numberOfLines={5} testID="clamp">
        {PREVIEW}
      </Text>
      <Text variant="body" testID="probe">
        {PREVIEW}
      </Text>
    </>,
  );
  const clamp = flat(screen.getByTestId('clamp').props.style) as Css;
  const probe = flat(screen.getByTestId('probe').props.style) as Css;
  expect(clamp.textWrapStyle).toBe('pretty');
  expect(clamp.textWrapStyle).toBe(probe.textWrapStyle);
  expect(clamp.textWrap).toBeUndefined();
});
