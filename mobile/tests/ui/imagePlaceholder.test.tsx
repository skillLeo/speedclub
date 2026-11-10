/** M1.9: native keeps expo-image's own `{ blurhash }` placeholder; only the web build swaps it for a data URL. */
import { screen } from '@testing-library/react-native';

import { hydrateThemePreference } from '@/theme';
import { Avatar } from '@/ui/Avatar';
import { imagePlaceholder } from '@/ui/imagePlaceholder';

import { renderUi } from './helpers';

const HASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

beforeAll(hydrateThemePreference);

describe('image placeholder on native', () => {
  it('keeps the blurhash and leaves the placeholder fit to the component', () => {
    expect(imagePlaceholder(HASH, 'contain')).toEqual({ placeholder: { blurhash: HASH } });
    expect(imagePlaceholder(undefined, 'cover')).toEqual({});
  });

  it('Avatar passes the blurhash on to expo-image', async () => {
    await renderUi(<Avatar name="Lukas Schneider" uri="https://x/a.webp" blurhash={HASH} testID="a" />);
    const image = screen.getByTestId('a.image', { includeHiddenElements: true });
    expect(JSON.stringify(image.props.placeholder)).toContain(`blurhash:/${HASH}`);
    expect(image.props.placeholderContentFit).toBeUndefined();
  });
});
