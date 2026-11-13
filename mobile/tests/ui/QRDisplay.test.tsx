import { screen } from '@testing-library/react-native';
import { Platform, useWindowDimensions } from 'react-native';

import { hydrateThemePreference, radius, size, space, themes, typography } from '@/theme';
import { QRDisplay, urlSegments } from '@/ui/QRDisplay';

import { flat, renderUi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0h4v4H0z"/></svg>';

describe('QRDisplay', () => {
  it('is a white card radius 16 padding 24, exempt as qr for the audit', async () => {
    await renderUi(<QRDisplay svg={svg} label="QR-Code" code="7H2K QXMB" testID="q" />);
    const card = screen.getByTestId('q');
    expect(card.props.dataSet).toEqual({ qaExempt: 'qr' });
    const style = flat(card.props.style);
    expect(style.backgroundColor).toBe(themes.carbon.color.qr.bg);
    expect(style.borderRadius).toBe(radius.md);
    expect(style.padding).toBe(space[24]);
  });

  it('stays white in the light theme token set too', () => {
    expect(themes.light.color.qr.bg).toBe(themes.carbon.color.qr.bg);
    expect(themes.black.color.qr.fg).toBe(themes.carbon.color.qr.fg);
  });

  it('sizes the code between 200 and 320, always square', async () => {
    await renderUi(<QRDisplay svg={svg} label="QR-Code" code="7H2K QXMB" testID="q" />);
    const code = flat(screen.getByTestId('q.code').props.style);
    expect(code.minWidth).toBe(size.qrMinOnScreen);
    expect(code.maxWidth).toBe(size.qrMaxOnScreen);
    expect(code.aspectRatio).toBe(1);
  });

  it('names the code as an image and shows code and URL in the qr tokens', async () => {
    await renderUi(<QRDisplay svg={svg} label="QR-Code für R34" code="7H2K QXMB" url="speedclub.de/c/7H2KQXMB" testID="q" />);
    expect(screen.getByTestId('q.code').props['aria-label']).toBe('QR-Code für R34');
    const code = flat(screen.getByTestId('q.shortCode').props.style);
    expect(code.fontSize).toBe(typography.headline.fontSize);
    expect(code.color).toBe(themes.carbon.color.qr.fg);
    const url = flat(screen.getByTestId('q.url').props.style);
    expect(url.fontSize).toBe(typography.caption.fontSize);
    expect(url.color).toBe(themes.carbon.color.qr.caption);
  });

  it('splits the URL once, after the last slash', () => {
    expect(urlSegments('speedclub.de/C/7H2KQXMB')).toEqual(['speedclub.de/C/', '7H2KQXMB']);
    expect(urlSegments('speedclub.de')).toEqual(['speedclub.de']);
    expect(urlSegments('speedclub.de/')).toEqual(['speedclub.de/']);
  });

  it('keeps one clean URL in the text at 360 wide, font scale 2, with a break the browser can take', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'web';
    dimensions.mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 2 });
    await renderUi(<QRDisplay svg={svg} label="QR-Code" code="7H2K QXMB" url="speedclub.de/C/7H2KQXMB" testID="q" />);
    Platform.OS = originalOS;
    expect(screen.getByTestId('q.url')).toHaveTextContent('speedclub.de/C/7H2KQXMB');
    expect(flat(screen.getByText('speedclub.de/C/').props.style).display).toBe('inline-block');
    expect(flat(screen.getByText('7H2KQXMB').props.style).display).toBe('inline-block');
    // No fixed or minimum width anywhere that could push the text out of the card's padding of 24.
    expect(flat(screen.getByTestId('q').props.style).padding).toBe(space[24]);
    expect(flat(screen.getByTestId('q.url').props.style).minWidth).toBeUndefined();
  });

  it('takes the image the server returns', async () => {
    await renderUi(<QRDisplay imageUri="https://x/qr.png" label="QR-Code" code="7H2K QXMB" testID="q" />);
    expect(screen.getByTestId('q.code')).toBeTruthy();
    expect(screen.queryByTestId('q.url')).toBeNull();
  });
});
