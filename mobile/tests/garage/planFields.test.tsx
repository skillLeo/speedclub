/**
 * M5.3 GAR-10 plans (10 §5.9, contract docs/reports/phase-5/m5.3-contract.md §1, §4.1): the Plan group while the status is Geplant
 * (Zielmonat as Monat + Jahr, Priorität, the private Budget), the payload, the range check, the server's 422s, the note when a plan
 * stops being one, and VEH-01's "Plan anlegen" preset (system first, status Geplant).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { targetFrom } from '@/features/garage/components/PlanFields';
import { addMonths, modPayload, modValuesFrom, type ModFormValues } from '@/features/garage/modForm';
import { currentMonth, modSchema } from '@/features/garage/schemas';
import { ModEditorScreen } from '@/features/garage/screens/ModEditorScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { SUSPENSION_FIELDS, VEHICLE_ID, vehicle, wheelMod } from './fixtures';
import { list, ME, renderScreen, signIn, stubFetch } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/garage',
  useNavigation: () => ({ getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  usePreventRemove: jest.fn(),
  Link: ({ children }: { children: unknown }) => children,
}));
type MockListProps = { data: readonly unknown[]; renderItem: (info: { item: unknown; index: number }) => ReactNode };
jest.mock('@shopify/flash-list', () => {
  const { forwardRef } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList({ data, renderItem }, _ref) {
    return <>{data.map((item, index) => renderItem({ item, index }))}</>;
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

// Jest's window reports a font scale of 2, so Monat and Jahr stack and the helper and error sit under Jahr (DQ-M53-16).
// A whole form in the real stack: keystroke-driven tests take several seconds on a busy machine (as tests/garage/screens.test.tsx).
jest.setTimeout(60_000);

const MONTH = currentMonth(new Date());
const NEXT_YEAR = Number(MONTH.slice(0, 4)) + 1;
const SUSPENSION = { id: 2, key: 'suspension', name: 'Fahrwerk', icon: 'coilover', fields: SUSPENSION_FIELDS };

function answers(extra: Record<string, { status?: number; body: unknown } | (() => { status?: number; body: unknown })> = {}) {
  return {
    '/api/v1/auth/me': ME,
    [`GET /api/v1/vehicles/${VEHICLE_ID}`]: { body: { data: vehicle() } },
    '/api/v1/catalog/mod-categories': list([SUSPENSION]),
    '/api/v1/catalog/brands': list([]),
    ...extra,
  };
}

/** A stored plan of the owner: KW V3 for March next year, high priority, a budget of 1.200 €. */
function storedPlan() {
  return wheelMod({
    id: '01plan',
    title: 'KW V3',
    category: { key: 'suspension', name: 'Fahrwerk', icon: 'coilover' },
    fields: { brand: 'KW', model: 'V3' },
    status: 'planned',
    status_label: 'Geplant',
    installed_on: null,
    installed_label: null,
    cost: null,
    target_month: `${NEXT_YEAR}-03`,
    target_label: `März ${NEXT_YEAR}`,
    priority: 'high',
    priority_label: 'Hoch',
    plan_sort: 0,
    budget: { cents: 120000, label: 'Budget 1.200 €' },
  });
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  signIn();
});
afterAll(() => useSessionStore.setState({ status: 'loading', member: null }));

describe('GAR-10 plan values (pure)', () => {
  const base = (values: Partial<ModFormValues>): ModFormValues => ({ ...modValuesFrom(undefined, SUSPENSION_FIELDS, 'de', { status: 'planned' }), ...values });
  const schema = modSchema(SUSPENSION_FIELDS, 'de', '2026-11');

  it('starts a preset plan as Geplant with empty plan fields', () => {
    expect(base({})).toMatchObject({ status: 'planned', targetMonth: '', priority: '', budget: '' });
  });

  it('sends the target month and the priority only with a plan, the budget always', () => {
    const plan = modPayload(base({ targetMonth: '2027-03', priority: 'high', budget: '1.200' }), SUSPENSION_FIELDS, 'de', { titleTouched: false, staggered: false });
    expect(plan).toMatchObject({ status: 'planned', installed_on: null, target_month: '2027-03', priority: 'high', budget_cents: 120000 });
    const built = modPayload(base({ status: 'installed', targetMonth: '2027-03', priority: 'high', budget: '1.200' }), SUSPENSION_FIELDS, 'de', { titleTouched: false, staggered: false });
    expect(built).not.toHaveProperty('target_month');
    expect(built).not.toHaveProperty('priority');
    expect(built.budget_cents).toBe(120000);
    expect(modPayload(base({}), SUSPENSION_FIELDS, 'de', { titleTouched: false, staggered: false })).toMatchObject({ target_month: null, priority: null, budget_cents: null });
    expect(plan).not.toHaveProperty('plan_sort');
  });

  it('allows past months from January 2000 and up to ten years ahead, and checks the budget as an amount', () => {
    const issues = (values: Partial<ModFormValues>) => {
      const result = schema.safeParse(base(values));
      return result.success ? [] : result.error.issues.map((item) => `${item.path.join('.')}:${item.message}`);
    };
    expect(issues({ targetMonth: '2024-05' })).toEqual([]);
    expect(issues({ targetMonth: addMonths('2026-11', 120) })).toEqual([]);
    expect(issues({ targetMonth: addMonths('2026-11', 121) })).toEqual(['targetMonth:validation.targetMonth']);
    expect(issues({ targetMonth: '1999-12' })).toEqual(['targetMonth:validation.targetMonth']);
    expect(issues({ budget: 'viel' })).toEqual(['budget:validation.cost']);
    // A month that no longer counts (the status is not Geplant) never holds a save back.
    expect(issues({ status: 'installed', targetMonth: '2099-01', title: 'Klappenauspuff' })).toEqual([]);
  });

  it('fills the other half of Monat + Jahr sensibly and stays inside the range', () => {
    expect(targetFrom('2026-11', '', { month: 12 })).toBe('2026-12');
    expect(targetFrom('2026-11', '', { month: 3 })).toBe('2027-03');
    expect(targetFrom('2026-11', '', { year: 2028 })).toBe('2028-11');
    expect(targetFrom('2026-11', '2027-03', { year: 2029 })).toBe('2029-03');
    expect(targetFrom('2026-11', '2036-06', { month: 12 })).toBe('2036-11');
  });
});

describe('GAR-10 as a plan', () => {
  it('asks for the system first when VEH-01 opens a new plan, and keeps the preset', async () => {
    mockParams = { id: VEHICLE_ID, modId: 'new', status: 'planned' };
    stubFetch(answers());
    await renderScreen(<ModEditorScreen />);
    await fireEvent.press(await screen.findByTestId('GAR-10.categories.suspension'));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ category: 'suspension' });
  });

  it('creates a plan with Zielmonat, Priorität and the private Budget', async () => {
    mockParams = { id: VEHICLE_ID, modId: 'new', status: 'planned', category: 'suspension' };
    const { calls } = stubFetch(answers({ [`POST /api/v1/vehicles/${VEHICLE_ID}/mods`]: { status: 201, body: { data: { id: '01new' } } } }));
    await renderScreen(<ModEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-10.group.plan')).toBeTruthy());
    expect(screen.getByTestId('GAR-10.status.planned').props.accessibilityState.checked).toBe(true);
    expect(screen.queryByTestId('GAR-10.installedOn')).toBeNull();
    expect(screen.getByTestId('GAR-10.budget.helper')).toHaveTextContent('Nur für dich sichtbar.');
    // DQ-M53-09: while planned the budget is the plan's money; Kosten come once it is built.
    expect(screen.queryByTestId('GAR-10.cost')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('GAR-10.field.brand'), 'KW');
    await fireEvent.press(screen.getByTestId('GAR-10.targetMonth'));
    await fireEvent.press(await screen.findByTestId('GAR-10.targetMonthSheet.option.3'));
    await fireEvent.press(screen.getByTestId('GAR-10.targetYear'));
    await fireEvent.press(await screen.findByTestId(`GAR-10.targetYearSheet.option.${NEXT_YEAR}`));
    expect(screen.getByTestId('GAR-10.targetYear.helper')).toHaveTextContent(`Ziel: März ${NEXT_YEAR}`);
    await fireEvent.press(screen.getByTestId('GAR-10.priority.high'));
    expect(screen.getByTestId('GAR-10.priority.high').props.accessibilityState.checked).toBe(true);
    await fireEvent.changeText(screen.getByTestId('GAR-10.budget'), '1.200');

    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/mods'))).toBe(true));
    const create = calls.find((call) => call.method === 'POST' && call.path.endsWith('/mods'));
    expect(create?.body).toMatchObject({ category: 'suspension', status: 'planned', installed_on: null, target_month: `${NEXT_YEAR}-03`, priority: 'high', budget_cents: 120000 });
    expect(create?.body).not.toHaveProperty('plan_sort');
  });

  it('shows the server\'s 422 on the target month under the field', async () => {
    mockParams = { id: VEHICLE_ID, modId: 'new', status: 'planned', category: 'suspension' };
    stubFetch(
      answers({
        [`POST /api/v1/vehicles/${VEHICLE_ID}/mods`]: {
          status: 422,
          body: { message: 'Die Angaben sind ungültig.', code: 'validation_failed', errors: { target_month: ['Der Zielmonat liegt zu weit in der Zukunft.'] } },
        },
      }),
    );
    await renderScreen(<ModEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-10.group.plan')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('GAR-10.field.brand'), 'KW');
    await fireEvent.press(screen.getByTestId('GAR-10.targetMonth'));
    await fireEvent.press(await screen.findByTestId('GAR-10.targetMonthSheet.option.3'));
    await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    expect(await screen.findByTestId('GAR-10.targetYear.error')).toHaveTextContent('Der Zielmonat liegt zu weit in der Zukunft.');
  });

  it('edits a stored plan, and moves its budget into Kosten when it is no longer planned (DQ-M53-09)', async () => {
    mockParams = { id: VEHICLE_ID, modId: '01plan' };
    const plan = storedPlan();
    const { calls } = stubFetch(
      answers({
        'GET /api/v1/mods/01plan': { body: { data: plan } },
        'PATCH /api/v1/mods/01plan': { body: { data: { ...plan, status: 'installed', history_recorded: true } } },
      }),
    );
    await renderScreen(<ModEditorScreen />);
    await waitFor(() => expect(screen.getByTestId('GAR-10.targetYear.helper')).toHaveTextContent(`Ziel: März ${NEXT_YEAR}`));
    expect(screen.getByTestId('GAR-10.priority.high').props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId('GAR-10.budget')).toHaveDisplayValue('1.200');
    expect(screen.queryByTestId('GAR-10.planLeaving')).toBeNull();

    await fireEvent.press(screen.getByTestId('GAR-10.status.installed'));
    expect(screen.queryByTestId('GAR-10.group.plan')).toBeNull();
    // DQ-M53-09: one money field: the budget moves into Kosten, and the note says so.
    expect(screen.getByTestId('GAR-10.planLeaving')).toHaveTextContent('Nicht mehr geplant: Zielmonat und Priorität entfallen. Dein Budget steht jetzt bei den Kosten.');
    expect(screen.getByTestId('GAR-10.cost')).toHaveDisplayValue('1.200');
    expect(screen.queryByTestId('GAR-10.budget')).toBeNull();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('GAR-10.cta.primary'));
    });
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toMatchObject({ status: 'installed', cost_cents: 120000, budget_cents: null });
    expect(patch?.body).not.toHaveProperty('target_month');
    expect(patch?.body).not.toHaveProperty('priority');
  });
});
