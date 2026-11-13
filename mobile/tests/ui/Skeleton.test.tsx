import { act, screen } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';

import { hydrateThemePreference, radius, typography } from '@/theme';
import { Skeleton, SKELETON_DELAY_MS, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('Skeleton', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('stays invisible for 300 ms, keeping its geometry', async () => {
    expect(SKELETON_DELAY_MS).toBe(300);
    await renderUi(
      <Skeleton testID="s">
        <SkeletonBlock height={40} width={40} testID="b" />
      </Skeleton>,
    );
    expect(flat(screen.getByTestId('s').props.style).opacity).toBe(0);
    expect(flat(screen.getByTestId('b').props.style).height).toBe(40);
    await act(async () => {
      jest.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(flat(screen.getByTestId('s').props.style).opacity).toBeUndefined();
  });

  it('announces loading with the common string', async () => {
    await renderUi(
      <Skeleton testID="s">
        <SkeletonBlock height={40} />
      </Skeleton>,
    );
    expect(screen.getByTestId('s').props.role).toBe('progressbar');
    expect(screen.getByTestId('s').props['aria-label']).toBe('Wird geladen');
    expect(screen.getByTestId('s').props['aria-busy']).toBe(true);
  });

  it('a block takes a radius token and an aspect ratio', async () => {
    await renderUi(
      <Skeleton>
        <SkeletonBlock aspectRatio={4 / 3} corner="md" testID="b" />
      </Skeleton>,
    );
    const block = flat(screen.getByTestId('b').props.style);
    expect(block.aspectRatio).toBeCloseTo(4 / 3);
    expect(block.borderRadius).toBe(radius.md);
  });

  it('a block outside a Skeleton brings its own delay', async () => {
    await renderUi(<SkeletonBlock height={20} testID="b" />);
    expect(screen.getByTestId('b')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('text lines take the line height of the variant, the last line is shorter', async () => {
    await renderUi(
      <Skeleton>
        <SkeletonText variant="headline" lines={3} testID="t" />
      </Skeleton>,
    );
    const root = screen.getByTestId('t');
    const lines = root.children.filter((child) => typeof child !== 'string');
    expect(lines).toHaveLength(3);
    const line = lines[0];
    expect(flat(line && typeof line !== 'string' ? line.props.style : undefined).height).toBe(
      typography.headline.lineHeight * PixelRatio.getFontScale(),
    );
  });
});
