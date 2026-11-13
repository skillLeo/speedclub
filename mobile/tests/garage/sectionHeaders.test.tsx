/**
 * ADR-426 e / DQ-906 / DQ-928: grouped-list and form section headers are one role everywhere: `callout.strong` 14/20 600 in
 * text.secondary, sentence case, one weight step above the `callout` 500 field labels. The garage FormGroup and RowGroup
 * match, a group sits space.32 below the one before it (space.24 below the column's top), its header space.8 above its
 * first field, and the skeleton line that stands for a header has the header's line height and place.
 */
import { screen } from '@testing-library/react-native';
import { PixelRatio, Text as RNText } from 'react-native';

import { FormGroup } from '@/features/garage/components/fields';
import { FormSkeleton } from '@/features/garage/components/frames';
import { hydrateThemePreference, space, themes, typography } from '@/theme';
import { RowGroup, SECTION_HEADER_ROLE } from '@/ui/RowGroup';

import { renderUi, textOf } from '../ui/helpers';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

beforeAll(hydrateThemePreference);

const role = typography[SECTION_HEADER_ROLE];

describe('Section headers (ADR-426 e)', () => {
  it('is callout.strong: the callout size one weight above the field labels', () => {
    expect(SECTION_HEADER_ROLE).toBe('calloutStrong');
    expect(role.fontSize).toBe(typography.callout.fontSize);
    expect(role.lineHeight).toBe(typography.callout.lineHeight);
    expect(role.fontFamily).toBe('Inter-SemiBold');
    expect(typography.callout.fontFamily).toBe('Inter-Medium');
  });

  it('spaces a form group space.32 from the one before, its header space.8 above the first field', async () => {
    await renderUi(
      <FormGroup title="Motor" testID="form">
        <RNText>Feld</RNText>
      </FormGroup>,
    );
    const group = textOf(screen.getByTestId('form').props.style);
    // The form column sets space.24 between its children (frames.tsx); the group adds space.8: 32 between groups, and the
    // first sits 24 below the column's space.16 top padding.
    expect(group.marginTop).toBe(space[8]);
    expect((group as { gap?: number }).gap).toBe(space[16]);
    expect(Number((group as { gap?: number }).gap) + Number(textOf(screen.getByTestId('form.title').props.style).marginBottom)).toBe(space[8]);
  });

  it('sets the form group header and the list group header in the same role and tone', async () => {
    await renderUi(
      <>
        <FormGroup title="Dieses Fahrzeug" testID="form">
          <RNText>Feld</RNText>
        </FormGroup>
        <RowGroup title="Sicherheit" testID="list">
          <RNText>Zeile</RNText>
        </RowGroup>
      </>,
    );
    for (const id of ['form.title', 'list.title']) {
      const header = screen.getByTestId(id);
      const style = textOf(header.props.style);
      expect(style.fontFamily).toBe(role.fontFamily);
      expect(style.fontSize).toBe(role.fontSize);
      expect(style.lineHeight).toBe(role.lineHeight);
      expect(style.color).toBe(themes.carbon.color.text.secondary);
      expect(header.props.role).toBe('heading');
    }
    // Sentence case: the role does not uppercase.
    expect(textOf(screen.getByTestId('form.title').props.style).textTransform).toBeUndefined();
  });

  it('draws the form skeleton’s header line at the header’s line height and place', async () => {
    await renderUi(<FormSkeleton routeId="GAR-05" groups={[2, 1]} />);
    for (const group of [0, 1]) {
      const line = screen.getByTestId(`GAR-05.skeleton.header.${group}`, { includeHiddenElements: true });
      const box = line.children.find((child) => typeof child !== 'string');
      expect(box && typeof box !== 'string' ? textOf(box.props.style).height : null).toBe(role.lineHeight * PixelRatio.getFontScale());
      expect(textOf(line.props.style).marginBottom).toBe(space[8] - space[16]);
      const groupBox = line.parent;
      expect(groupBox ? textOf(groupBox.props.style).marginTop : null).toBe(space[8]);
    }
  });
});
