/**
 * The large title block on the web: never the browser's scroll anchor. From layout.breakpoints.desktop its title.1 grows
 * upwards inside the 52 block, so as the anchor it moved a scrolled tab root when the window crossed that width
 * (shell.spec "crossing a breakpoint": DISC-01 at 40 became 31 in Chromium and WebKit).
 */
import { screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { hydrateThemePreference, size } from '@/theme';
import { HeaderLargeTitle } from '@/ui/Header';

import { flat, renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

const originalOS = Platform.OS;
beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'web';
});
afterEach(() => {
  Platform.OS = originalOS;
});

describe('HeaderLargeTitle on web', () => {
  it('keeps its 52 block and opts out of scroll anchoring', async () => {
    await renderUi(<HeaderLargeTitle title="Entdecken" testID="l" />);
    const style = flat(screen.getByTestId('l').props.style) as Record<string, unknown>;
    expect(style.minHeight).toBe(size.headerLargeTitleBlock);
    expect(style.overflowAnchor).toBe('none');
  });
});
