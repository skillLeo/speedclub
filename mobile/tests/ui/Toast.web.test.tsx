import { screen } from '@testing-library/react-native';

import { hydrateThemePreference, size } from '@/theme';
import { ToastHost } from '@/ui/ToastHost';

import { flat, renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
jest.mock('expo-haptics', () => ({}));

beforeAll(hydrateThemePreference);

const bottomOf = () => flat(screen.getByTestId('toast.host').props.style).bottom;

describe('Toast on web, where only CSS knows the safe inset', () => {
  it('sits 8 above the tab bar and the CSS inset, as before', async () => {
    await renderUi(<ToastHost tabBarOffset={size.tabBar} />);
    expect(bottomOf()).toBe(`calc(env(safe-area-inset-bottom, 0px) + ${size.tabBar}px + 8px)`);
  });

  it('sits 8 above a measured sticky bar, which holds the CSS inset already', async () => {
    await renderUi(<ToastHost stickyBarHeight={77} />);
    expect(bottomOf()).toBe('calc(max(env(safe-area-inset-bottom, 0px) + 0px, 77px) + 8px)');
  });

  it('with both, above the higher one', async () => {
    await renderUi(<ToastHost tabBarOffset={size.tabBar} stickyBarHeight={77} />);
    expect(bottomOf()).toBe(`calc(max(env(safe-area-inset-bottom, 0px) + ${size.tabBar}px, 77px) + 8px)`);
  });
});
