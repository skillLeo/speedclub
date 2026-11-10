/**
 * SEC-S-06: on the member web an e-mail field is type="text" with inputmode="email". Chromium's type="email" converts the domain
 * itself, transitionally, so `straße.de` left the browser as `strasse.de`, another domain and another account.
 */
import { act, render } from '@testing-library/react-native';
import { createElement, type ComponentType, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';

import { EMAIL_INPUT, FormField } from '@/features/auth/components/FormField';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false, isIOS: false, isAndroid: false }));

/** The DOM element the field hands to its ref on web. */
const mockElement = { setAttribute: jest.fn(), focus: jest.fn() };
jest.mock('@/ui', () => {
  const { useLayoutEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    TextInput: ({ ref }: { ref?: (node: unknown) => void }) => {
      useLayoutEffect(() => ref?.(mockElement), [ref]);
      return null;
    },
  };
});

// react-native-web itself, as the export renders it, server-side so no DOM is needed.
const WebTextInput = jest.requireActual<{ TextInput: ComponentType<Record<string, unknown>> }>(
  'react-native-web/dist/cjs/index.js',
).TextInput;
// No @types/react-dom in this app: typed here, as far as the test needs it.
const { renderToStaticMarkup } = jest.requireActual<{ renderToStaticMarkup: (element: ReactElement) => string }>('react-dom/server');
const markupOf = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(WebTextInput, props));

describe('the e-mail field on the member web (SEC-S-06)', () => {
  it('renders as type="text", with autofill, no capitals and no spell check', () => {
    const { webInputMode: _ownAttribute, ...rnwProps } = EMAIL_INPUT as typeof EMAIL_INPUT & { webInputMode?: string };
    const html = markupOf({ ...rnwProps, value: 'max@straße.de' });
    expect(html).toMatch(/<input[^>]* type="text"/);
    expect(html).not.toContain('type="email"');
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('spellCheck="false"');
    expect(html).toContain('autoCapitalize="none"');
    // react-native-web sets no inputmode for it: an inputMode prop would turn the type into "email" again.
    expect(html).not.toMatch(/inputmode/i);
    expect(EMAIL_INPUT).not.toHaveProperty('inputMode');
  });

  it('the prop it leaves out would bring type="email" back, which is why the field sets inputmode itself', () => {
    expect(markupOf({ inputMode: 'email' })).toContain('type="email"');
  });

  it('puts inputmode="email" on the element, for the e-mail keyboard on phones', async () => {
    function Form() {
      const { control } = useForm<{ email: string }>({ defaultValues: { email: '' } });
      return <FormField control={control} name="email" label="E-Mail" {...EMAIL_INPUT} testID="AUTH-03.email" />;
    }
    await act(async () => {
      render(<Form />);
    });
    expect(mockElement.setAttribute).toHaveBeenCalledWith('inputmode', 'email');
  });
});
