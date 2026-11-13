/**
 * GAR-03's frame (FS-5) and its bare mode (DQ-254): a state in which no step can start keeps × and the title, and shows no
 * progress, no step rail and no preview, which would promise a flow that is not there.
 */
import { screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { WizardFrame, type WizardPreview } from '@/features/garage/components/WizardFrame';
import { hydrateThemePreference, themes, typography } from '@/theme';

import { textOf } from '../ui/helpers';
import { renderScreen } from './harness';

const mockWindow = { current: { width: 390, height: 844, scale: 1, fontScale: 1 } };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow.current }));

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/add-vehicle',
  useNavigation: () => ({ getParent: () => undefined, canGoBack: () => true, goBack: jest.fn(), getState: () => undefined }),
  usePreventRemove: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const PREVIEW: WizardPreview = { title: 'Neues Fahrzeug', photo: { source: null } };

function frame(bare: boolean) {
  return (
    <WizardFrame step="vehicle" draftId="new" reached={1} preview={PREVIEW} ready={false} bare={bare} dirty={false}>
      <Text testID="body">Deine Garage ist voll</Text>
    </WizardFrame>
  );
}

beforeAll(hydrateThemePreference);

describe.each([
  ['phone', 390],
  ['desktop', 1280],
])('on a %s (%i)', (_kind, width) => {
  beforeEach(() => {
    mockWindow.current = { width, height: 844, scale: 1, fontScale: 1 };
  });

  it('a step shows its progress, and the desktop its rail and preview', async () => {
    await renderScreen(frame(false));
    expect(screen.getByTestId('GAR-03.progress')).toBeTruthy();
    expect(screen.queryByTestId('GAR-03.rail') !== null).toBe(width >= 1280);
    expect(screen.queryByTestId('GAR-03.preview') !== null).toBe(width >= 1280);
  });

  it('bare keeps × and the body alone (DQ-254)', async () => {
    await renderScreen(frame(true));
    expect(screen.getByTestId('GAR-03.header')).toBeTruthy();
    expect(screen.getByTestId('body')).toBeTruthy();
    expect(screen.queryByTestId('GAR-03.progress')).toBeNull();
    expect(screen.queryByTestId('GAR-03.rail')).toBeNull();
    expect(screen.queryByTestId('GAR-03.preview')).toBeNull();
  });
});

describe('on the desktop, the type roles (ADR-426 e, f)', () => {
  beforeEach(() => {
    mockWindow.current = { width: 1280, height: 844, scale: 1, fontScale: 1 };
  });

  it('sets the preview header as a section header and each step link in the action role', async () => {
    await renderScreen(frame(false));
    const header = textOf(screen.getByTestId('GAR-03.preview.title').props.style);
    // ADR-426 e as amended (DQ-928): callout.strong, one weight above the field labels.
    expect(header.fontFamily).toBe(typography.calloutStrong.fontFamily);
    expect(header.fontSize).toBe(typography.calloutStrong.fontSize);
    expect(header.color).toBe(themes.carbon.color.text.secondary);
    const step = textOf(screen.getByText('Fahrzeug').props.style);
    expect(step.fontFamily).toBe(typography.bodyStrong.fontFamily);
    expect(step.fontSize).toBe(typography.bodyStrong.fontSize);
  });
});
