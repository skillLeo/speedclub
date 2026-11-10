/**
 * The sidebar's account slot on web, where axe checks WCAG 2.5.3 (label in name) against everything visible inside a
 * named control, the avatar's initials included.
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import type { TestInstance, TestNode } from 'test-renderer';

import { AccountSlot } from '@/features/shell/Sidebar';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { renderUi } from '../ui/helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
jest.mock('expo-haptics', () => ({}));

const mockRouter = { navigate: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router'), useRouter: () => mockRouter }));

beforeAll(hydrateThemePreference);

beforeEach(() => {
  mockRouter.navigate.mockClear();
  mockRouter.push.mockClear();
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null });
});

const labelOf = (node: TestInstance): unknown => node.props['aria-label'] ?? node.props.accessibilityLabel;

const isHidden = (node: TestInstance) =>
  node.props['aria-hidden'] === true ||
  node.props.accessibilityElementsHidden === true ||
  node.props.importantForAccessibility === 'no-hide-descendants';

/** The name a browser computes from the content: aria-hidden subtrees drop out, a child's label replaces its text. */
function nameFromContent(node: TestNode): string {
  if (typeof node === 'string') return node;
  if (isHidden(node)) return '';
  const label = labelOf(node);
  if (typeof label === 'string' && label !== '') return label;
  return node.children.map(nameFromContent).filter(Boolean).join(' ');
}

/** Every text inside, hidden or not: what axe counts as the visible label. */
function visibleText(node: TestNode): string {
  if (typeof node === 'string') return node;
  return node.children.map(visibleText).filter(Boolean).join(' ');
}

describe('sidebar account slot on web', () => {
  it('the member link is named by the visible name; the initials are hidden and no label leaves them out', async () => {
    await act(async () => setMember({ id: '1', username: 'lukas.sc', displayName: 'Lukas Scholz', avatarUrl: null }));
    await renderUi(<AccountSlot />);
    const link = screen.getByTestId('shell.sidebar.account');
    expect(link.props.role ?? link.props.accessibilityRole).toBe('link');
    expect(labelOf(link)).toBeUndefined();
    // The initials are on screen, so a label of the name alone would not contain the visible text.
    expect(visibleText(link)).toContain('LS');
    expect(nameFromContent(link)).toBe('Lukas Scholz');
    await fireEvent.press(link);
    expect(mockRouter.navigate).toHaveBeenCalledWith('/profile');
  });

  it('a member without a display name is named by the username', async () => {
    await act(async () => setMember({ id: '2', username: 'nina.neu', displayName: null, avatarUrl: null }));
    await renderUi(<AccountSlot />);
    const link = screen.getByTestId('shell.sidebar.account');
    expect(labelOf(link)).toBeUndefined();
    expect(nameFromContent(link)).toBe('nina.neu');
  });

  it('the guest link keeps a label that is exactly its visible text', async () => {
    await renderUi(<AccountSlot />);
    const link = screen.getByTestId('shell.sidebar.signIn');
    expect(labelOf(link)).toBe('Anmelden');
    expect(visibleText(link)).toBe('Anmelden');
    expect(within(link).getByText('Anmelden')).toBeTruthy();
  });
});
