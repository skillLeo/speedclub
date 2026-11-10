// Axe on the M2.7 signature screens (m2.7-api-handover.md): VEH-06 compare of the demo R34 and G82, VEH-07 share card, WEB-04
// /app-laden, WEB-07 /email/{verify,reset}, every forced state, and the overlays a tap opens on lukas.sc's R34: the compare picker
// of VEH-01, the download sheet of QR-02 with the placards, the legal-status sheet of GAR-10 and the blur mode of GAR-08. Read only:
// every overlay closes again before anything is saved.
import { axeOverlays, axeScreens, axeStates } from '../support/axe-cases';
import { demoIds, R34 } from '../support/garage.mjs';

const COMPARE = `/app/compare?a=${R34.slug}&b=bmw-m4-g82-f3pqxpjb`;
const shareCard = async () => `/app/share-card/${(await demoIds()).r34}`;

axeScreens([
  { name: 'VEH-06', path: COMPARE, auth: 'guest', ready: '[data-testid="VEH-06.cars"]' },
  { name: 'VEH-07', path: shareCard, auth: 'member', ready: '[data-testid="VEH-07.preview.image"]' },
  { name: 'QR-02 with the scans row', path: async () => `/app/qr/${(await demoIds()).r34}`, auth: 'member', ready: '[data-testid="QR-02.scans"]' },
  { name: 'WEB-04', path: '/app-laden', auth: 'guest', ready: '[data-testid="WEB-04.root"]' },
  { name: 'WEB-07 verify', path: '/email/verify', auth: 'guest', ready: '[data-testid="WEB-07.root"]' },
  { name: 'WEB-07 reset', path: '/email/reset', auth: 'guest', ready: '[data-testid="WEB-07.root"]' },
]);

axeStates([
  { route: 'VEH-06', path: COMPARE, auth: 'guest', states: { loading: 'VEH-06.skeleton', empty: 'VEH-06.missing', error: 'VEH-06.error' } },
  { route: 'VEH-07', path: shareCard, auth: 'member', states: { loading: 'VEH-07.skeleton', empty: 'VEH-07.unavailable', error: 'VEH-07.error' } },
]);

axeOverlays([
  {
    name: 'VEH-01 with the compare picker open',
    path: `/app/v/${R34.slug}`,
    auth: 'guest',
    ready: '[data-testid="VEH-01.title"]',
    open: async (_page, byTestId) => {
      await byTestId('VEH-01.moreActions').click();
      await byTestId('VEH-01.moreSheet.compare.body').click();
      return byTestId('VEH-01.comparePicker');
    },
  },
  {
    name: 'QR-02 with the download sheet open',
    path: async () => `/app/qr/${(await demoIds()).r34}`,
    auth: 'member',
    ready: '[data-testid="QR-02.card"]',
    open: async (page, byTestId) => {
      await page.locator('[data-testid="QR-02.download"]:visible').click();
      await byTestId('QR-02.download.placardA5').waitFor();
      return byTestId('QR-02.downloadSheet');
    },
  },
  {
    name: 'GAR-10 with the legal-status sheet open',
    path: async () => {
      const ids = await demoIds();
      return `/app/garage/${ids.r34}/mods/${ids.r34Mod}`;
    },
    auth: 'member',
    ready: '[data-testid="GAR-10.legalStatus"]',
    open: async (_page, byTestId) => {
      await byTestId('GAR-10.legalStatus').click();
      return byTestId('GAR-10.legalStatusSheet');
    },
  },
  {
    name: 'GAR-08 in the blur mode',
    path: async () => {
      const ids = await demoIds();
      return `/app/garage/${ids.r34}/photos/${ids.r34Photo}`;
    },
    auth: 'member',
    ready: '[data-testid="GAR-08.blur.start"]',
    open: async (_page, byTestId) => {
      await byTestId('GAR-08.blur.start').click();
      return byTestId('GAR-08.blur.stage');
    },
    close: async (_page, byTestId) => byTestId('GAR-08.blur.cancel').click(),
  },
]);
