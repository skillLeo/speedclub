/**
 * M5.3 VEH-01 one scroll (10 §5, ADR-505): the section index (scroll-to, current section), the inline expands, Pläne with the
 * owner's actions (contract docs/reports/phase-5/m5.3-contract.md §4), Build-Fortschritt, and VEH-08.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { PlanRow } from '@/api/queries/plans';
import type { PublicModRow, PublicVehicle } from '@/api/queries/vehicles';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { FullHistoryScreen } from '@/features/vehicle/screens/FullHistoryScreen';
import { VehicleScreen } from '@/features/vehicle/screens/VehicleScreen';
import { useViewAsStore } from '@/features/viewAs/viewAsSession';
import NetInfo from '@react-native-community/netinfo';
import { sectionScrollTarget } from '@/features/vehicle/sections';
import { haptics } from '@/lib/haptics';
import { __setAccessibilityForTests } from '@/ui/motion';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, size, space } from '@/theme';

import { R34 } from './fixtures';
import { renderWithProviders, stubFetch, type Answer } from './harness';

const SLUG = R34.slug;
const mockParams: { slug: string; section?: string } = { slug: SLUG };
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => `/v/${mockParams.slug}`,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));

// Rows render in place; every row answers 1000 high, so a row's top is its index × 1000.
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown) => string;
  horizontal?: boolean;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
  onLayout?: (event: { nativeEvent: { layout: { height: number } } }) => void;
  onContentSizeChange?: (width: number, height: number) => void;
  onEndReached?: () => void;
};
const mockList: { props: MockListProps | null; scrollToOffset: jest.Mock; scrollToIndex: jest.Mock } = {
  props: null,
  scrollToOffset: jest.fn(),
  scrollToIndex: jest.fn(() => Promise.resolve()),
};
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({
      scrollToOffset: mockList.scrollToOffset,
      scrollToIndex: mockList.scrollToIndex,
      getLayout: (index: number) => ({ x: 0, y: index * 1000, width: 390, height: 1000 }),
      getFirstItemOffset: () => 0,
      getScrollableNode: () => null,
    }));
    if (!props.horizontal) mockList.props = props;
    const items = props.data.map((item, index) => createElement(Fragment, { key: props.keyExtractor ? props.keyExtractor(item) : index }, props.renderItem({ item, index })));
    return createElement(Fragment, null, props.ListHeaderComponent, props.data.length === 0 ? props.ListEmptyComponent : items, props.ListFooterComponent);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
// A new key per intent, so a test can tell a retry (same key) from a new attempt (new key).
const mockUuid = { next: 0 };
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${(mockUuid.next += 1)}` }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const text = (testID: string) => screen.getByTestId(testID);
const signIn = () => useSessionStore.setState({ status: 'member', member: { id: 'owner', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null } });

/** The list has laid out: 800 of viewport over 20 000 of content. */
async function layOut() {
  await act(() => {
    mockList.props?.onLayout?.({ nativeEvent: { layout: { height: 800 } } });
    mockList.props?.onContentSizeChange?.(390, 20_000);
  });
}

const built = (mod: PublicModRow, id: string, title: string): PublicModRow => ({ ...mod, id, title, summary_line: title, status: 'installed', status_label: 'Verbaut' });
const planned = (id: string, title: string, extra: Partial<PlanRow> = {}): PlanRow => ({
  ...R34.mods.groups[1]!.items[0]!,
  id,
  title,
  summary_line: title,
  status: 'planned',
  status_label: 'Geplant',
  installed_on: null,
  installed_label: null,
  target_month: '2027-03',
  target_label: 'März 2027',
  is_due: false,
  priority: 'high',
  priority_label: 'Hoch',
  plan_sort: 0,
  budget: null,
  ...extra,
});

/** R34 with two plans from the M5.3 server: the page's `plans` and `build_progress` (contract §3). */
function withPlans(vehicle: PublicVehicle, plans: PlanRow[], owner = false): PublicVehicle {
  const builtRows = vehicle.mods.groups.flatMap((group) => group.items).filter((mod) => mod.status === 'installed').length;
  const groups = vehicle.mods.groups.map((group) => ({ ...group, items: group.items.filter((mod) => mod.status !== 'planned') }));
  const firstGroup = groups[1]!;
  groups[1] = { ...firstGroup, items: [...firstGroup.items, ...plans] };
  return {
    ...vehicle,
    is_owner: owner,
    owner: vehicle.owner ? { ...vehicle.owner, is_self: owner } : null,
    mods: { ...vehicle.mods, groups },
    plans: { count: plans.length, items: plans },
    build_progress: { built: builtRows, planned: plans.length, total: builtRows + plans.length, percent: Math.floor((builtRows / (builtRows + plans.length)) * 100) },
  } as unknown as PublicVehicle;
}

const KW = planned('01plankw00000000000000000a', 'KW V3 Clubsport', { budget: { cents: 240000, label: 'Budget 2.400 €' }, is_due: true, target_label: 'Oktober 2026' });
const BRAKES = planned('01planbrakes00000000000000', 'Brembo GT', { priority: null, priority_label: null, plan_sort: 1, target_label: 'Mai 2027' });

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams.slug = SLUG;
  delete mockParams.section;
  mockUuid.next = 0;
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('VEH-01 section index (10 §5.5)', () => {
  it('is a navigation of links to the sections this build has, the one in view marked', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    const nav = text('VEH-01.sections');
    expect(nav.props.role).toBe('navigation');
    expect(text('VEH-01.sections.list').props.role).toBe('list');
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.props.testID)).toEqual(['overview', 'specs', 'mods', 'plans', 'history', 'gallery'].map((key) => `VEH-01.sections.${key}`));
    expect(links.map((link) => within(link).getByText(/./).props.children)).toEqual(['Überblick', 'Daten', 'Mods', 'Pläne', 'Verlauf', 'Galerie']);
    // DQ-P5-038: at the top of the page Überblick is current, and only it.
    // The spy marks it once the rows are measured.
    await waitFor(() =>
      expect(within(text('VEH-01.sections')).getAllByRole('link').map((link) => link.props.accessibilityState?.selected === true)).toEqual([
        true,
        false,
        false,
        false,
        false,
        false,
      ]),
    );
  });

  it('scrolls to a section with spring.calm and marks it current at once', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await layOut();
    await fireEvent.press(text('VEH-01.sections.mods'));
    expect(text('VEH-01.sections.mods').props.accessibilityState?.selected).toBe(true);
    expect(text('VEH-01.sections.specs').props.accessibilityState?.selected).toBeFalsy();
    // Mods is row 5 (stage, summary, index, Überblick, Daten): its heading lands under the floating bar and the chip row.
    const target = sectionScrollTarget(5000, { pinnedTop: size.header, indexHeight: size.chip + 2 * space[4] + size.border.control, gap: space[16] }, 20_000 - 800);
    await waitFor(() => expect(mockList.scrollToOffset).toHaveBeenLastCalledWith({ offset: target, animated: false }));
  });

  it('moves the screen reader to the section heading after a jump, and leaves a touch jump alone (review SF-4)', async () => {
    // RN's Jest setup mocks both; swapped here and put back as they were (a spy's restore would leave them without an answer).
    const originalEnabled = AccessibilityInfo.isScreenReaderEnabled;
    const originalSend = AccessibilityInfo.sendAccessibilityEvent;
    const focus = jest.fn();
    AccessibilityInfo.isScreenReaderEnabled = jest.fn(() => Promise.resolve(true));
    AccessibilityInfo.sendAccessibilityEvent = focus;
    try {
      await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
      await layOut();
      await act(async () => {
        await Promise.resolve();
      });
      await fireEvent.press(text('VEH-01.sections.history'));
      await waitFor(() => expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus'));
      const [node] = focus.mock.calls[focus.mock.calls.length - 1] ?? [];
      expect((node as { props?: { testID?: string } } | undefined)?.props?.testID ?? null).toBe('VEH-01.section.history.title.text');
    } finally {
      AccessibilityInfo.isScreenReaderEnabled = originalEnabled;
      AccessibilityInfo.sendAccessibilityEvent = originalSend;
    }
  });

  it('lands a deep link exactly and keeps its section current (DQ-M53-01)', async () => {
    const pinned = { pinnedTop: size.header, indexHeight: size.chip + 2 * space[4] + size.border.control, gap: space[16] };
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} initialSection="plans" />);
    await layOut();
    // Pläne is row 6: the list finds the row, then the settle corrects to the exact place under the index.
    await waitFor(() => expect(mockList.scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 6, animated: false })));
    await waitFor(() => expect(mockList.scrollToOffset).toHaveBeenCalledWith({ offset: sectionScrollTarget(6000, pinned, 20_000 - 800), animated: false }));
    expect(text('VEH-01.sections.plans').props.accessibilityState?.selected).toBe(true);
    expect(text('VEH-01.sections.mods').props.accessibilityState?.selected).toBeFalsy();
  });

  it('jumps without travel under reduced motion, to the same place and the same current section (DQ-M53-01)', async () => {
    const pinned = { pinnedTop: size.header, indexHeight: size.chip + 2 * space[4] + size.border.control, gap: space[16] };
    await act(async () => __setAccessibilityForTests({ reduceMotion: true }));
    try {
      await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
      await layOut();
      await fireEvent.press(text('VEH-01.sections.history'));
      // Verlauf is row 7 (Pläne is there for the planned Tomei): one jump, no spring frames in between.
      const target = sectionScrollTarget(7000, pinned, 20_000 - 800);
      expect(mockList.scrollToOffset).toHaveBeenCalledWith({ offset: target, animated: false });
      expect(mockList.scrollToOffset.mock.calls.every(([call]) => (call as { offset: number }).offset === target)).toBe(true);
      expect(text('VEH-01.sections.history').props.accessibilityState?.selected).toBe(true);
    } finally {
      await act(async () => __setAccessibilityForTests({ reduceMotion: false }));
    }
  });

  it('labels the description "Beschreibung" (CF-3)', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    expect(text('VEH-01.descriptionTitle')).toHaveTextContent('Beschreibung');
    expect(text('VEH-01.descriptionTitle').props.role).toBe('heading');
    expect(within(text('VEH-01.descriptionBlock')).getByTestId('VEH-01.description')).toBeTruthy();
  });

  it('never opens the viewer with the press that ends a swipe of the hero (CF-5)', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    const pager = screen.getByLabelText(/^Fotos: /);
    const swiped = { nativeEvent: { contentOffset: { x: 393, y: 0 }, contentSize: { width: 1179, height: 491 }, layoutMeasurement: { width: 393, height: 491 } } };
    await fireEvent.scroll(pager, swiped);
    await fireEvent(pager, 'scrollEndDrag', swiped);
    await fireEvent.press(text('VEH-01.hero.1'));
    expect(screen.queryByTestId('VEH-04.viewer')).toBeNull();
    expect(text('VEH-01.photoCount')).toHaveTextContent('2/3');
  });

  it('opens the viewer on a press after paging without a drag (wheel, keys), which is no swipe (CF-5)', async () => {
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    const pager = screen.getByLabelText(/^Fotos: /);
    await fireEvent.scroll(pager, { nativeEvent: { contentOffset: { x: 393, y: 0 }, contentSize: { width: 1179, height: 491 }, layoutMeasurement: { width: 393, height: 491 } } });
    await fireEvent.press(text('VEH-01.hero.1'));
    expect(await screen.findByTestId('VEH-04.viewer.counter')).toHaveTextContent('2/3');
  });

  it('leaves Pläne out for a visitor of a build without plans, and Galerie for a build without photos', async () => {
    const bare = { ...withPlans(R34, []), photos: [], photo_count: 0, cover: null } as PublicVehicle;
    await renderWithProviders(<VehicleProfile vehicle={bare} onBack={jest.fn()} />);
    expect(within(text('VEH-01.sections')).getAllByRole('link').map((link) => link.props.testID)).toEqual(
      ['overview', 'specs', 'mods', 'history'].map((key) => `VEH-01.sections.${key}`),
    );
    expect(screen.queryByTestId('VEH-01.section.plans')).toBeNull();
    expect(screen.queryByTestId('VEH-01.section.gallery')).toBeNull();
  });
});

describe('VEH-01 Mods: top three per system and "+ N weitere" (10 §5.8)', () => {
  it('opens the rest of a system in place and closes it again', async () => {
    const wheels = R34.mods.groups[0]!;
    const five = [0, 1, 2, 3, 4].map((n) => built(wheels.items[0]!, `01wheel${n}`.padEnd(26, '0'), `Satz ${n + 1}`));
    const vehicle = { ...R34, mods: { ...R34.mods, groups: [{ ...wheels, count: 5, items: five }, ...R34.mods.groups.slice(1)] } };
    await renderWithProviders(<VehicleProfile vehicle={vehicle} onBack={jest.fn()} />);
    const group = text('VEH-01.mods.wheels_tires');
    expect(group).toHaveTextContent(/^Räder & Reifen\s5/);
    expect(within(group).getByText('Satz 3')).toBeTruthy();
    expect(within(group).queryByText('Satz 4')).toBeNull();
    const toggle = text('VEH-01.mods.wheels_tires.toggle');
    expect(toggle).toHaveTextContent('+ 2 weitere');
    expect(screen.getByLabelText('2 weitere Mods in Räder & Reifen anzeigen')).toBeTruthy();
    expect(toggle.props.accessibilityState.expanded).toBe(false);
    await fireEvent.press(toggle);
    expect(within(text('VEH-01.mods.wheels_tires.rest')).getByText('Satz 5')).toBeTruthy();
    expect(text('VEH-01.mods.wheels_tires.toggle')).toHaveTextContent('Weniger anzeigen');
    expect(text('VEH-01.mods.wheels_tires.toggle').props.accessibilityState.expanded).toBe(true);
    await fireEvent.press(text('VEH-01.mods.wheels_tires.toggle'));
    expect(screen.queryByTestId('VEH-01.mods.wheels_tires.rest')).toBeNull();
    // A system with three or fewer has no toggle.
    expect(screen.queryByTestId('VEH-01.mods.suspension.toggle')).toBeNull();
  });
});

describe('VEH-01 Pläne (10 §5.9, contract §2–§4)', () => {
  it('shows a visitor each plan with its target month and priority, never a budget or an owner action', async () => {
    await renderWithProviders(<VehicleProfile vehicle={withPlans(R34, [KW, BRAKES])} onBack={jest.fn()} />);
    const plans = text('VEH-01.plans');
    expect(text('VEH-01.section.plans.title')).toHaveTextContent('Pläne 2');
    expect(within(plans).getAllByText(/KW V3 Clubsport|Brembo GT/).map((node) => node.props.children)).toEqual(['KW V3 Clubsport', 'Brembo GT']);
    expect(text(`VEH-01.plan.${KW.id}.status`)).toHaveTextContent('Ziel Oktober 2026');
    // Review N3: the priority has its own pill (the legal-status slot stays the legal status).
    expect(text(`VEH-01.plan.${KW.id}.priority`)).toHaveTextContent('Hoch');
    expect(screen.queryByTestId(`VEH-01.plan.${KW.id}.legalStatus`)).toBeNull();
    expect(within(plans).queryByText(/Budget/)).toBeNull();
    expect(screen.queryByTestId(`VEH-01.plan.${KW.id}.install`)).toBeNull();
    expect(screen.queryByTestId('VEH-01.plans.sort')).toBeNull();
    // Plans are not built: Mods leaves them out.
    expect(within(text('VEH-01.buildSheet')).queryByText('KW V3 Clubsport')).toBeNull();
  });

  it('gives the owner the budget, "Fällig" once the month has come, and "Als verbaut markieren" with the success haptic', async () => {
    signIn();
    const success = jest.spyOn(haptics, 'success');
    const { calls } = stubFetch({
      [`/mods/${KW.id}/install`]: { body: { data: { ...KW, status: 'installed', status_label: 'Verbaut', installed_on: '2026-11', history_recorded: true } } },
    });
    await renderWithProviders(<VehicleProfile vehicle={withPlans(R34, [KW, BRAKES], true)} onBack={jest.fn()} />);
    expect(text(`VEH-01.plan.${KW.id}`)).toHaveTextContent(/Budget 2\.400 €/);
    expect(text(`VEH-01.plan.${KW.id}.status`)).toHaveTextContent('Fällig seit Oktober 2026');
    expect(text('VEH-01.plans.private')).toHaveTextContent('Budgets siehst nur du.');

    await fireEvent.press(text(`VEH-01.plan.${KW.id}.install`));
    expect(await screen.findByTestId('VEH-01.plans.installDialog.title')).toHaveTextContent('KW V3 Clubsport verbaut?');
    await fireEvent.press(text('VEH-01.plans.installDialog.confirm'));
    await waitFor(() => expect(calls.some((call) => new URL(call.url).pathname.endsWith(`/mods/${KW.id}/install`))).toBe(true));
    const call = calls.find((entry) => new URL(entry.url).pathname.endsWith(`/mods/${KW.id}/install`))!;
    expect(call.method).toBe('POST');
    expect(call.headers.get('Idempotency-Key')).toMatch(/^uuid-\d+$/);
    // DQ-M53-09: the plan's budget becomes its cost (no cost was entered).
    expect(await call.json()).toEqual({ installed_on: expect.stringMatching(/^\d{4}-\d{2}$/), cost_cents: 240000 });
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
  });

  it('lets the owner reorder the plans and sends every planned id once', async () => {
    signIn();
    const { calls } = stubFetch({ [`/vehicles/${R34.id}/plans/order`]: { body: { data: [BRAKES, KW] } } });
    await renderWithProviders(<VehicleProfile vehicle={withPlans(R34, [KW, BRAKES], true)} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.plans.sort'));
    expect(text('VEH-01.plans.sortHint')).toBeTruthy();
    await fireEvent(text('VEH-01.plans.sortable'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 350, height: 128 } } });
    await fireEvent(text(`VEH-01.plans.sortable.${BRAKES.id}.handle`), 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
    await fireEvent.press(text('VEH-01.plans.sortDone'));
    await waitFor(() => expect(calls.some((entry) => new URL(entry.url).pathname.endsWith('/plans/order'))).toBe(true));
    const call = calls.find((entry) => new URL(entry.url).pathname.endsWith('/plans/order'))!;
    expect(call.method).toBe('PUT');
    expect(await call.json()).toEqual({ ids: [BRAKES.id, KW.id] });
  });

  it('invites the owner of a build without plans with a sample plan, badged "Beispiel", and one action', async () => {
    signIn();
    await renderWithProviders(<VehicleProfile vehicle={withPlans(R34, [], true)} onBack={jest.fn()} />);
    expect(within(text('VEH-01.plans.sample')).getByText('Beispiel', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(text('VEH-01.plans.add'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/garage/[id]/mods/[modId]', params: { id: R34.id, modId: 'new', status: 'planned' } });
  });
});

describe('VEH-01 Build-Fortschritt (10 §6.2)', () => {
  it('shows a visitor the share built and leads to Pläne', async () => {
    await renderWithProviders(<VehicleProfile vehicle={withPlans(R34, [KW, BRAKES])} onBack={jest.fn()} />);
    await layOut();
    // 12 built, 2 planned: floor(12 / 14 × 100) = 85.
    expect(text('VEH-01.progress.percent')).toHaveTextContent('85');
    expect(text('VEH-01.progress.line')).toHaveTextContent('12 von 14 Mods verbaut · 2 geplant');
    expect(text('VEH-01.progress.bar').props).toMatchObject({ role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 85 });
    await fireEvent.press(text('VEH-01.progress.showPlans'));
    expect(text('VEH-01.sections.plans').props.accessibilityState?.selected).toBe(true);
  });

  it('is not there for a visitor without plans; the owner gets the invitation instead', async () => {
    const view = await renderWithProviders(<VehicleProfile vehicle={withPlans(R34, [])} onBack={jest.fn()} />);
    expect(screen.queryByTestId('VEH-01.progress')).toBeNull();
    await view.unmount();
    signIn();
    await renderWithProviders(<VehicleProfile vehicle={withPlans(R34, [], true)} onBack={jest.fn()} />);
    expect(text('VEH-01.progress.empty')).toHaveTextContent(/^Plane dein nächstes Upgrade/);
    expect(screen.queryByTestId('VEH-01.progress.percent')).toBeNull();
  });
});

/** What NetInfo tells every handler the rendered screen registered (src/state/online.ts). */
function connectivity(isConnected: boolean) {
  for (const [listener] of jest.mocked(NetInfo.addEventListener).mock.calls) (listener as (state: { isConnected: boolean }) => void)({ isConnected });
}

/** The page as the owner reads it through the route (the query cache), with a fetch that answers the install as `install` says. */
function ownerRoute(install: (call: number) => Answer | 'network', reorder?: Answer) {
  signIn();
  const page = withPlans(R34, [KW, BRAKES], true);
  const calls: { url: string; method: string; key: string | null; body: string }[] = [];
  let installs = 0;
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    const path = new URL(request.url).pathname;
    calls.push({ url: path, method: request.method, key: request.headers.get('Idempotency-Key'), body: request.method === 'GET' ? '' : await request.clone().text() });
    const json = (answer: Answer) => new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    if (path.endsWith(`/mods/${KW.id}/install`)) {
      installs += 1;
      const answer = install(installs);
      if (answer === 'network') throw new TypeError('Network request failed');
      return json(answer);
    }
    if (path.endsWith('/plans/order') && reorder) return json(reorder);
    if (path.endsWith(`/public/vehicles/${SLUG}`)) return json({ body: { data: page } });
    return json({ status: 404, body: { message: 'Nicht gefunden', code: 'not_found' } });
  }) as unknown as typeof fetch;
  return { calls, installsOf: () => calls.filter((call) => call.url.endsWith('/install')) };
}

async function confirmInstall() {
  await fireEvent.press(await screen.findByTestId(`VEH-01.plan.${KW.id}.install`));
  await fireEvent.press(await screen.findByTestId('VEH-01.plans.installDialog.confirm'));
}

describe('VEH-01 Pläne: failures, retries and locks (review SF-1, SF-6)', () => {
  afterEach(() => act(() => useViewAsStore.setState({ status: 'off', staff: null, username: null, reason: null })));

  it('puts the plan back after a 409 and starts the next attempt with a new key', async () => {
    const route = ownerRoute((call) => (call === 1 ? { status: 409, body: { message: 'Diese Mod ist nicht mehr geplant.', code: 'mod_not_planned', errors: {} } } : { body: { data: { ...KW, status: 'installed', status_label: 'Verbaut', installed_on: '2026-11', installed_label: 'November 2026', history_recorded: true } } }));
    await renderWithProviders(<VehicleScreen />);
    await confirmInstall();
    await waitFor(() => expect(route.installsOf()).toHaveLength(1));
    // Back in Pläne, out of Mods.
    await waitFor(() => expect(within(screen.getByTestId('VEH-01.plans')).getByText('KW V3 Clubsport')).toBeTruthy());
    expect(within(screen.getByTestId('VEH-01.buildSheet')).queryByText('KW V3 Clubsport')).toBeNull();
    await confirmInstall();
    await waitFor(() => expect(route.installsOf()).toHaveLength(2));
    const [first, second] = route.installsOf();
    expect(second?.key).not.toBe(first?.key);
  });

  it('keeps the same Idempotency-Key when the answer was lost, so the retry is safe', async () => {
    const route = ownerRoute((call) => (call === 1 ? 'network' : { body: { data: { ...KW, status: 'installed', status_label: 'Verbaut', installed_on: '2026-11', installed_label: 'November 2026', history_recorded: true } } }));
    await renderWithProviders(<VehicleScreen />);
    await confirmInstall();
    await waitFor(() => expect(route.installsOf()).toHaveLength(1));
    await waitFor(() => expect(within(screen.getByTestId('VEH-01.plans')).getByText('KW V3 Clubsport')).toBeTruthy());
    await confirmInstall();
    await waitFor(() => expect(route.installsOf()).toHaveLength(2));
    const [first, second] = route.installsOf();
    expect(first?.key).toMatch(/^uuid-\d+$/);
    expect(second?.key).toBe(first?.key);
    expect(JSON.parse(second?.body ?? '{}')).toEqual({ installed_on: expect.stringMatching(/^\d{4}-\d{2}$/), cost_cents: 240000 });
  });

  it('puts the order back after a 422 (a plan changed meanwhile)', async () => {
    const route = ownerRoute(() => ({ body: {} }), { status: 422, body: { message: 'Die Pläne haben sich geändert.', code: 'validation_failed', errors: { ids: ['Die Pläne haben sich geändert. Lade die Seite neu.'] } } });
    await renderWithProviders(<VehicleScreen />);
    await fireEvent.press(await screen.findByTestId('VEH-01.plans.sort'));
    await fireEvent(screen.getByTestId('VEH-01.plans.sortable'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 350, height: 128 } } });
    await fireEvent(screen.getByTestId(`VEH-01.plans.sortable.${BRAKES.id}.handle`), 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
    await fireEvent.press(screen.getByTestId('VEH-01.plans.sortDone'));
    await waitFor(() => expect(route.calls.some((call) => call.url.endsWith('/plans/order'))).toBe(true));
    await waitFor(() => {
      const titles = within(screen.getByTestId('VEH-01.plans.list')).getAllByText(/KW V3 Clubsport|Brembo GT/).map((node) => node.props.children);
      expect(titles).toEqual(['KW V3 Clubsport', 'Brembo GT']);
    });
  });

  it('locks "Sortieren" and "Als verbaut markieren" offline: they say why and send nothing', async () => {
    const route = ownerRoute(() => ({ body: {} }));
    await renderWithProviders(<VehicleScreen />);
    const install = await screen.findByTestId(`VEH-01.plan.${KW.id}.install`);
    try {
      await act(async () => connectivity(false));
      expect(screen.getByTestId(`VEH-01.plan.${KW.id}.install`).props.accessibilityState.disabled).toBe(true);
      expect(screen.getByTestId('VEH-01.plans.sort').props.accessibilityState.disabled).toBe(true);
      await fireEvent.press(install);
      expect(screen.queryByTestId('VEH-01.plans.installDialog.title')).toBeNull();
      expect(route.installsOf()).toHaveLength(0);
    } finally {
      await act(async () => connectivity(true));
    }
  });

  it('locks them for staff viewing as the member (view-as is read-only, M3.5)', async () => {
    signIn();
    await act(async () => useViewAsStore.setState({ status: 'active', username: 'lukas.sc' }));
    await renderWithProviders(<VehicleProfile vehicle={withPlans(R34, [KW, BRAKES], true)} onBack={jest.fn()} />);
    expect(screen.getByTestId(`VEH-01.plan.${KW.id}.install`).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('VEH-01.plans.sort').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId(`VEH-01.plan.${KW.id}.install`));
    expect(screen.queryByTestId('VEH-01.plans.installDialog.title')).toBeNull();
  });

  it('opens at the section a link names (`?section=plans`) and jumps there without motion', async () => {
    ownerRoute(() => ({ body: {} }));
    mockParams.section = 'plans';
    await renderWithProviders(<VehicleScreen />);
    expect(await screen.findByTestId('VEH-01.section.plans')).toBeTruthy();
    await layOut();
    // Pläne is row 6: stage, summary, index, Überblick, Daten, Mods.
    await waitFor(() => expect(mockList.scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 6, animated: false })));
  });
});

describe('VEH-08 full history (10 §5.10, contract §4.4)', () => {
  it('lists the page\'s entries by month and pages older ones with the cursor', async () => {
    const older = { ...R34.updates[0]!, id: 'older', month_label: 'Januar 2022' };
    const { calls } = stubFetch({
      [`/public/vehicles/${SLUG}`]: { body: { data: { ...R34, updates_count: 8 } } },
      '/updates': { body: { data: [older], links: {}, meta: { next_cursor: null, per_page: 30, path: null, prev_cursor: null } } },
    });
    await renderWithProviders(<FullHistoryScreen />);
    expect(await screen.findByTestId('VEH-08.vehicle')).toHaveTextContent(/^Skyline GT/);
    // DQ-M53-08: the build's cover heads the page.
    expect(screen.getByTestId('VEH-08.cover')).toBeTruthy();
    expect(text('VEH-08.count')).toHaveTextContent('8 Einträge');
    for (const update of R34.updates) expect(text(`VEH-08.update.${update.id}`)).toBeTruthy();
    expect(await screen.findByTestId('VEH-08.update.older')).toBeTruthy();
    const list = calls.find((call) => new URL(call.url).pathname.endsWith('/updates'));
    expect(new URL(list!.url).search).toBe('?per_page=30');
    expect(await screen.findByTestId('VEH-08.end')).toHaveTextContent('Das ist der erste Eintrag dieses Builds.');
    await fireEvent.press(text(`VEH-08.update.${R34.updates[1]!.id}`));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${SLUG}/updates/${R34.updates[1]!.id}`);
  });

  it('shows a sample entry, badged "Beispiel", when the build has no history', async () => {
    stubFetch({
      [`/public/vehicles/${SLUG}`]: { body: { data: { ...R34, updates: [], updates_count: 7 } } },
      '/updates': { body: { data: [], links: {}, meta: { next_cursor: null, per_page: 30, path: null, prev_cursor: null } } },
    });
    await renderWithProviders(<FullHistoryScreen />);
    expect(await screen.findByTestId('VEH-08.empty')).toHaveTextContent(/Noch keine Einträge im Verlauf\./);
    // DQ-M53-07 b: no "7 Einträge" over an empty list.
    expect(screen.queryByTestId('VEH-08.count')).toBeNull();
    expect(within(screen.getByTestId('VEH-08.sample', { includeHiddenElements: true })).getByText('Beispiel', { includeHiddenElements: true })).toBeTruthy();
  });

  it('answers a hidden vehicle with the calm unavailable state', async () => {
    stubFetch({ [`/public/vehicles/${SLUG}`]: { status: 404, body: { message: 'Fahrzeug nicht verfügbar.', code: 'vehicle_unavailable', errors: {} } } });
    await renderWithProviders(<FullHistoryScreen />);
    expect(await screen.findByTestId('VEH-08.unavailable')).toBeTruthy();
  });
});
