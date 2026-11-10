// Axe on the M2.4 messaging screens with lukas.sc's seeded conversations (m2.4-api-handover.md §12): MSG-01 (Chats, Anfragen,
// Archiviert, a guest), MSG-02 (jann.ptrs's thread as lukas.sc; kenji.r34's context-card thread as kenji, so lukas.sc's unread
// message stays unread), MSG-03 (empty and with a recipient and a build), MSG-04 (the request, never marked read) and MSG-05; every
// forced state; and the sheets a tap opens: the organise sheet of a row, the message actions and the attach sheet, each on a
// conversation of two test members of its own. Nothing is pinned, muted or deleted (every sheet closes with Escape).
import type { BrowserContext } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { axeOverlays, axeScreens, axeStates } from '../support/axe-cases';
import { follow, members, named, sendText, startConversation } from '../support/flow';

const JANN = '01m5wpk0c0e8jjewpe4ycappww';
const KENJI = '01m5qvzg200gc60g288tcg08r4';
const MAX = '01m63k07g0m4m0p4wwggarp6tm';

axeScreens([
  { name: 'MSG-01 chats', path: '/app/messages', auth: 'member', ready: '[data-testid^="MSG-01.row."]' },
  { name: 'MSG-01 requests', path: '/app/messages?folder=requests', auth: 'member', ready: `[data-testid="MSG-01.row.${MAX}"]` },
  { name: 'MSG-01 archived', path: '/app/messages?folder=archived', auth: 'member', ready: '[data-testid^="MSG-01.row."]' },
  { name: 'MSG-01 guest', path: '/app/messages', auth: 'guest', ready: '[data-testid="MSG-01.guest"]' },
  { name: 'MSG-02 thread', path: `/app/messages/${JANN}`, auth: 'member', ready: '[data-testid^="MSG-02.message."]' },
  { name: 'MSG-02 context card', path: `/app/messages/${KENJI}`, auth: 'member-kenji', ready: '[data-testid="MSG-02.context"]' },
  { name: 'MSG-03', path: '/app/new-message', auth: 'member', ready: '[data-testid="MSG-03.root"]' },
  { name: 'MSG-03 about a build', path: '/app/new-message?to=jann.ptrs&about=bmw-m4-g82-f3pqxpjb', auth: 'member', ready: '[data-testid="MSG-03.about"]' },
  { name: 'MSG-04', path: `/app/messages/requests/${MAX}`, auth: 'member', ready: '[data-testid="MSG-04.request.accept"]' },
  { name: 'MSG-05', path: `/app/messages/${JANN}/info`, auth: 'member', ready: '[data-testid="MSG-05.member"]' },
]);

axeStates([
  { route: 'MSG-01', path: '/app/messages', auth: 'member', states: { loading: 'MSG-01.skeleton', empty: 'MSG-01.emptyChats', error: 'MSG-01.error', offline: 'MSG-01.offlineBanner', restricted: 'MSG-01.restricted' } },
  { route: 'MSG-02', path: `/app/messages/${JANN}`, auth: 'member', states: { loading: 'MSG-02.skeleton', empty: 'MSG-02.empty', error: 'MSG-02.error', offline: 'MSG-02.offlineBanner', restricted: 'MSG-02.closed' } },
  { route: 'MSG-03', path: '/app/new-message', auth: 'member', states: { loading: 'MSG-03.skeleton', error: 'MSG-03.error', offline: 'MSG-03.offline', restricted: 'MSG-03.restricted' } },
  { route: 'MSG-04', path: `/app/messages/requests/${MAX}`, auth: 'member', states: { loading: 'MSG-04.skeleton', empty: 'MSG-04.empty', error: 'MSG-04.error' } },
  { route: 'MSG-05', path: `/app/messages/${JANN}/info`, auth: 'member', states: { loading: 'MSG-05.skeleton', empty: 'MSG-05.gone', error: 'MSG-05.error' } },
]);

/**
 * The overlay cells use a conversation of their own (two test members, the viewer follows the other, who writes first), not
 * lukas.sc's: every axe cell of the run reads as lukas.sc, and together they exhausted his per-member limits in load runs. Each
 * cell sets up its own pair; the path is read after the setup.
 */
function ownChat(): { auth: (context: BrowserContext) => Promise<void>; id: () => string } {
  let conversationId = '';
  return {
    auth: async (context) => {
      const [me, other] = await members('axechat', 'axechatother');
      await named(other, 'Lea Hartmann');
      await follow(me, other.username);
      conversationId = (await startConversation(other, me.username, OTHER_TEXT)).conversation.id;
      await sendText(me, conversationId, 'Passt, ich bring die Felgen mit.');
      await useSession(context, me.session);
    },
    id: () => conversationId,
  };
}
const OTHER_TEXT = 'Treffen wir uns Samstag am Ring?';
const organise = ownChat();
const actions = ownChat();
const attach = ownChat();

axeOverlays([
  {
    name: 'MSG-01 with the organise sheet of a row open',
    path: async () => '/app/messages',
    auth: organise.auth,
    ready: '[data-testid^="MSG-01.row."]',
    open: async (_page, byTestId) => {
      await byTestId(`MSG-01.row.${organise.id()}.more`).click();
      return byTestId('MSG-01.organise');
    },
  },
  {
    name: 'MSG-02 with the message actions open',
    path: async () => `/app/messages/${actions.id()}`,
    auth: actions.auth,
    ready: '[data-testid^="MSG-02.message."]',
    open: async (page, byTestId) => {
      // On the web a press on a text message opens its actions.
      await page.locator('[data-testid^="MSG-02.message."][data-testid$=".press"]:visible').filter({ hasText: OTHER_TEXT }).first().click();
      return byTestId('MSG-02.actions');
    },
  },
  {
    name: 'MSG-02 with the attach sheet open',
    path: async () => `/app/messages/${attach.id()}`,
    auth: attach.auth,
    ready: '[data-testid="MSG-02.composer"]',
    open: async (_page, byTestId) => {
      await byTestId('MSG-02.composer.attach').click();
      return byTestId('MSG-02.attach');
    },
  },
]);
