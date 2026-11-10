// Axe on the M2.5 settings screens and AUTH-11 (m2.5-api-handover.md), as lukas.sc unless a guest is the point: SET-01 to SET-15
// (without SET-08, 10, 17, 18, which earlier specs cover), every forced state, and the overlays a tap opens: the re-auth sheet of
// SET-05 and SET-12, the delete confirm of SET-13, the sign-out dialog of SET-01. Read only: every overlay closes again (Escape or
// Abbrechen) before anything is sent.
import { axeOverlays, axeScreens, axeStates } from '../support/axe-cases';

axeScreens([
  { name: 'SET-01 member', path: '/app/settings', auth: 'member', ready: '[data-testid="SET-01.account"]' },
  { name: 'SET-01 guest', path: '/app/settings', auth: 'guest', ready: '[data-testid="SET-01.app"]' },
  { name: 'SET-02', path: '/app/settings/account', auth: 'member', ready: '[data-testid="SET-02.email"]' },
  { name: 'SET-03', path: '/app/settings/account/email', auth: 'member', ready: '[data-testid="SET-03.email"]' },
  { name: 'SET-04', path: '/app/settings/security/password', auth: 'member', ready: '[data-testid="SET-04.currentPassword"]' },
  { name: 'SET-05', path: '/app/settings/security/two-factor', auth: 'member', ready: '[data-testid="SET-05.status"]' },
  { name: 'SET-06', path: '/app/settings/security/sessions', auth: 'member', ready: '[data-testid^="SET-06.row."]' },
  { name: 'SET-07', path: '/app/settings/privacy', auth: 'member', ready: '[data-testid="SET-07.whoCanMessage.everyone"]' },
  { name: 'SET-09', path: '/app/settings/notifications', auth: 'member', ready: '[data-testid="SET-09.push"]' },
  { name: 'SET-11', path: '/app/settings/language', auth: 'member', ready: '[data-testid="SET-11.example"]' },
  { name: 'SET-12', path: '/app/settings/data/export', auth: 'member', ready: '[data-testid="SET-12.intro"]' },
  { name: 'SET-13', path: '/app/settings/data/delete', auth: 'member', ready: '[data-testid="SET-13.password"]' },
  { name: 'SET-14', path: '/app/settings/help', auth: 'member', ready: '[data-testid^="SET-14.row."]' },
  { name: 'SET-14 article', path: '/app/settings/help/two-factor', auth: 'guest', ready: '[data-testid="SET-14.article.body"]' },
  { name: 'SET-15', path: '/app/settings/help/contact', auth: 'member', ready: '[data-testid="SET-15.subject"]' },
  { name: 'AUTH-11 without a challenge', path: '/app/two-factor', auth: 'guest', ready: '[data-testid="AUTH-11.root"]' },
  { name: 'WEB-05', path: '/konto-loeschen', auth: 'guest', ready: '[data-testid="WEB-05.form"]' },
  { name: 'WEB-10', path: '/kontakt', auth: 'guest', ready: '[data-testid="WEB-10.form"]' },
]);

axeStates([
  { route: 'SET-02', path: '/app/settings/account', auth: 'member', states: { loading: 'SET-02.skeleton', error: 'SET-02.error', restricted: 'SET-02.restricted', offline: 'SET-02.offline' } },
  { route: 'SET-06', path: '/app/settings/security/sessions', auth: 'member', states: { loading: 'SET-06.skeleton', empty: 'SET-06.empty', error: 'SET-06.error' } },
  { route: 'SET-07', path: '/app/settings/privacy', auth: 'member', states: { loading: 'SET-07.skeleton', error: 'SET-07.error', restricted: 'SET-07.restricted', offline: 'SET-07.offline' } },
  { route: 'SET-09', path: '/app/settings/notifications', auth: 'member', states: { loading: 'SET-09.skeleton', error: 'SET-09.error' } },
  { route: 'SET-12', path: '/app/settings/data/export', auth: 'member', states: { loading: 'SET-12.skeleton', empty: 'SET-12.empty', error: 'SET-12.error', restricted: 'SET-12.restricted' } },
  { route: 'SET-14', path: '/app/settings/help', auth: 'member', states: { loading: 'SET-14.skeleton', empty: 'SET-14.empty', error: 'SET-14.error' } },
  { route: 'AUTH-11', path: '/app/two-factor', auth: 'guest', states: { loading: 'AUTH-11.skeleton', error: 'AUTH-11.notice', offline: 'AUTH-11.offline' } },
]);

axeOverlays([
  {
    name: 'SET-01 with the sign-out dialog open',
    path: '/app/settings',
    auth: 'member',
    ready: '[data-testid="SET-01.signOut"]',
    open: async (_page, byTestId) => {
      await byTestId('SET-01.signOut').click();
      return byTestId('SET-01.signOutDialog');
    },
    close: async (_page, byTestId) => byTestId('SET-01.signOutDialog.cancel').click(),
  },
  {
    name: 'SET-05 with the password sheet open',
    path: '/app/settings/security/two-factor',
    auth: 'member',
    ready: '[data-testid="SET-05.status"]',
    open: async (_page, byTestId) => {
      await byTestId('SET-05.cta.primary').click();
      return byTestId('SET-05.startSheet');
    },
  },
  {
    name: 'SET-12 with the password sheet open',
    path: '/app/settings/data/export',
    auth: 'member',
    ready: '[data-testid="SET-12.intro"]',
    open: async (_page, byTestId) => {
      await byTestId('SET-12.cta.primary').click();
      return byTestId('SET-12.reauth');
    },
  },
  {
    name: 'SET-13 with the delete confirm open',
    path: '/app/settings/data/delete',
    auth: 'member',
    ready: '[data-testid="SET-13.password"]',
    open: async (_page, byTestId) => {
      // The dialog asks only after a password and the checkbox; nothing is sent before its confirm.
      await byTestId('SET-13.password').fill('nur-zum-pruefen');
      await byTestId('SET-13.understood').click();
      await byTestId('SET-13.cta.primary').click();
      return byTestId('SET-13.dialog');
    },
    close: async (_page, byTestId) => byTestId('SET-13.dialog.cancel').click(),
  },
]);
