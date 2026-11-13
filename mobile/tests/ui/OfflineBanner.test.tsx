import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference, space, themes, typography } from '@/theme';
import { OfflineBanner } from '@/ui/OfflineBanner';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('OfflineBanner', () => {
  it('shows the exact copy from common in supporting, on bg.raised', async () => {
    await renderUi(<OfflineBanner testID="o" />);
    const text = screen.getByText('Offline – Änderungen werden gesendet, sobald du online bist.');
    expect(flat(text.props.style).fontSize).toBe(typography.callout.fontSize);
    expect(flat(screen.getByTestId('o').props.style).backgroundColor).toBe(themes.carbon.color.bg.raised);
  });

  it('has a minimum height, not a fixed one, so 200 % font cannot clip it', async () => {
    await renderUi(<OfflineBanner testID="o" />);
    const banner = flat(screen.getByTestId('o').props.style);
    expect(banner.minHeight).toBe(space[32]);
    expect(banner.height).toBeUndefined();
  });

  it('adds 8 above and below only when the text wraps', async () => {
    await renderUi(<OfflineBanner testID="o" />);
    const lineHeight = typography.callout.lineHeight * 2; // Jest's window has font scale 2.
    await fireEvent(screen.getByTestId('o.text'), 'layout', { nativeEvent: { layout: { height: lineHeight } } });
    expect(flat(screen.getByTestId('o').props.style).paddingVertical).toBe(space[4]);
    await fireEvent(screen.getByTestId('o.text'), 'layout', { nativeEvent: { layout: { height: lineHeight * 2 } } });
    expect(flat(screen.getByTestId('o').props.style).paddingVertical).toBe(space[8]);
  });

  it('is announced politely', async () => {
    await renderUi(<OfflineBanner testID="o" />);
    const banner = screen.getByTestId('o');
    expect(banner.props.role).toBe('status');
    expect(banner.props['aria-live']).toBe('polite');
  });
});
