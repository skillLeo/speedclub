// WCAG 2.5.3 label in name on web, as axe checks it (label-content-name-mismatch): the visible text of a labelled control, its
// boxes joined with nothing between them, must be a run of words in its accessible name, and here it starts it. A control
// whose visible text cannot be in a label (an avatar's initials) has no label on web: its visible text names it (M2.8).
import { screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import { ConversationRow } from '@/features/messages/components/ConversationRow';
import { MessageBubble } from '@/features/messages/components/MessageBubble';
import { ThreadHeader } from '@/features/messages/components/ThreadHeader';
import { hydrateThemePreference } from '@/theme';
import { ChatBubble } from '@/ui/ChatBubble';
import { Chip } from '@/ui/Chip';

import { R34, serverMessage, summary } from '../messages/fixtures';
import { renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
jest.mock('@/lib/clock', () => ({ now: () => new Date('2026-11-08T11:00:00+01:00') }));

beforeAll(hydrateThemePreference);

/** axe's tokens: letters and digits, everything else separates. */
function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean);
}

/** The visible text as axe reads it: every string in the subtree, joined without a space. */
function visibleWords(node: TestInstance): string[] {
  const parts: string[] = [];
  const walk = (child: TestInstance | string) => {
    if (typeof child === 'string') parts.push(child);
    else child.children.forEach(walk);
  };
  walk(node);
  return words(parts.join(''));
}

/** Pressable hands `aria-label` to its view as `accessibilityLabel`. */
function labelOf(node: TestInstance): string | undefined {
  return (node.props.accessibilityLabel ?? node.props['aria-label']) as string | undefined;
}

function startsWithVisibleText(node: TestInstance) {
  const label = labelOf(node);
  expect(label).toBeDefined();
  const visible = visibleWords(node);
  expect(visible.length).toBeGreaterThan(0);
  expect(words(label ?? '').slice(0, visible.length)).toEqual(visible);
}

const noop = () => undefined;

describe('label in name on web (M2.8 axe)', () => {
  it('DISC-02 filter chip: "Filter" and its count read as two words, at the start of "Filter, 3 aktiv"', async () => {
    await renderUi(<Chip label="Filter" icon="funnel" count={3} accessibilityLabel="Filter, 3 aktiv" onPress={noop} testID="chip" />);
    startsWithVisibleText(screen.getByTestId('chip'));
  });

  it('a text bubble does not run its last word into the time', async () => {
    await renderUi(<ChatBubble text="Samstag um 10" time="13:32" testID="b" />);
    expect(visibleWords(screen.getByTestId('b'))).toEqual(['samstag', 'um', '10', '13', '32']);
  });

  it('a vehicle bubble: title, owner and time first, then who sent it', async () => {
    const message = serverMessage({ id: '01JV', kind: 'vehicle', body: null, mine: true, senderUsername: null, vehicle: { ...R34, title: 'Nissan Silvia S15' } });
    await renderUi(
      <MessageBubble
        item={{ type: 'message', key: message.key, message, groupStart: true, groupEnd: true }}
        receipt={false}
        otherName="Jann"
        animateIn={false}
        reactions={false}
        onActions={noop}
        onRetry={noop}
        onRemove={noop}
        onOpenPhoto={noop}
        onOpenVehicle={noop}
        onReact={noop}
        testID="m"
      />,
    );
    const press = screen.getByTestId('m.press');
    startsWithVisibleText(press);
    expect(labelOf(press)).toMatch(/^Nissan Silvia S15, Fahrzeug von @lukas\.sc, \d{2}:\d{2}, Du$/);
  });

  it('MSG-01 row: no label on web, its visible text names it; pin, mute and the count name themselves', async () => {
    await renderUi(
      <ConversationRow
        conversation={summary({ id: 'c1', pinnedAt: '2026-11-07T10:00:00Z', muted: true, unreadCount: 2 })}
        organise={false}
        inset={16}
        onOpen={noop}
        onMore={noop}
        testID="row"
      />,
    );
    expect(labelOf(screen.getByTestId('row.open'))).toBeUndefined();
    expect(screen.getByLabelText('Angeheftet')).toBeTruthy();
    expect(screen.getByLabelText('Stummgeschaltet')).toBeTruthy();
    expect(screen.getByLabelText('2 ungelesene Nachrichten')).toBeTruthy();
  });

  it('MSG-02/04 header member: no label on web, the name and @handle beside the initials name it', async () => {
    await renderUi(
      <ThreadHeader member={{ username: 'max.e46', displayName: 'Max Ebert', avatar: null }} name="Max Ebert" onOpenMember={noop} testID="h" />,
    );
    expect(labelOf(screen.getByTestId('h.member'))).toBeUndefined();
  });
});
