import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { hydrateThemePreference } from '@/theme';
import { ChatBubble } from '@/ui/ChatBubble';

import { renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

beforeAll(hydrateThemePreference);

describe('ChatBubble on web', () => {
  it('only names the group, so the text inside stays readable and is not read twice', async () => {
    await renderUi(<ChatBubble text="Hallo" time="14:32" senderLabel="Lukas" testID="b" />);
    const group = screen.getByTestId('b');
    expect(group.props.role).toBe('group');
    expect(group.props['aria-label']).toBe('Lukas');
    expect(group.props.accessible).toBeUndefined();
    // The text ends in an invisible word boundary before the time (WCAG 2.5.3, labelInName.web.test).
    expect(screen.getByText(/^Hallo/).props['aria-label']).toBeUndefined();
  });
});

describe('ChatBubble words on web (DQ-428)', () => {
  it('never hyphenates what a member wrote; only an overlong token breaks', async () => {
    await renderUi(<ChatBubble text="Kreuzspeichenfelgen mit Eintragung" testID="h" />);
    const style = StyleSheet.flatten(screen.getByText(/Kreuzspeichen/).props.style) as Record<string, unknown>;
    expect(style.hyphens ?? 'manual').not.toBe('auto');
    expect(style.overflowWrap).toBe('anywhere');
  });
});
