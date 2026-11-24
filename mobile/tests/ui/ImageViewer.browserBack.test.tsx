/**
 * BL-25 (QA H1, 2026-11-23): on the member web the browser's back button or gesture left the build page while the photo viewer was
 * open, because the viewer owned no history entry. Now an open viewer pushes one entry (same URL, Expo Router's entry id kept), a back
 * closes the viewer and stays on the page, and a viewer closed any other way takes its entry off again. The Playwright side is
 * web/tests/e2e/hunt/viewer-back.spec.ts.
 */
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { useState } from 'react';

import { hydrateThemePreference } from '@/theme';
import { ImageViewer } from '@/ui/ImageViewer';

import { renderUi } from './helpers';

jest.mock('expo-haptics', () => ({}));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

beforeAll(hydrateThemePreference);

const images = [{ uri: 'https://example.test/1.jpg' }, { uri: 'https://example.test/2.jpg' }];

type Entry = { state: unknown; url: string };

/** A browser history as the page sees it: entries, an index, and popstate on back (asynchronous, as in a browser). */
function fakeBrowser() {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { window: g.window };
  const entries: Entry[] = [{ state: { id: 'router-entry-1' }, url: 'http://localhost/app/v/r34' }];
  let index = 0;
  const listeners = new Set<() => void>();
  const history = {
    get state() {
      return entries[index]?.state ?? null;
    },
    pushState: jest.fn((state: unknown, _title: string, url: string) => {
      entries.splice(index + 1, entries.length, { state, url });
      index = entries.length - 1;
    }),
    back: jest.fn(() => {
      if (index === 0) return;
      index -= 1;
      queueMicrotask(() => listeners.forEach((listener) => listener()));
    }),
  };
  const win = {
    history,
    get location() {
      return { href: entries[index]?.url ?? '' };
    },
    addEventListener: (type: string, listener: () => void) => type === 'popstate' && listeners.add(listener),
    removeEventListener: (type: string, listener: () => void) => type === 'popstate' && listeners.delete(listener),
  };
  // Only what a browser adds: the global object keeps everything else React Native's test environment needs.
  g.window = Object.assign(Object.create(saved.window as object), win);
  return {
    history,
    entries,
    index: () => index,
    /** The user presses the browser's back button. */
    pressBack: async () => {
      await act(async () => {
        history.back();
        await Promise.resolve();
      });
    },
    restore: () => {
      g.window = saved.window;
    },
  };
}

function Harness({ onClose, closeOnBrowserBack }: { onClose?: () => void; closeOnBrowserBack?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <ImageViewer
      visible={open}
      images={images}
      onClose={() => {
        onClose?.();
        setOpen(false);
      }}
      closeOnBrowserBack={closeOnBrowserBack}
      testID="v"
    />
  );
}

describe('BL-25: the browser back closes the image viewer first', () => {
  let browser: ReturnType<typeof fakeBrowser>;
  beforeEach(() => {
    browser = fakeBrowser();
  });
  afterEach(() => browser.restore());

  it('pushes one entry with the same URL that keeps the router id', async () => {
    await renderUi(<Harness />);
    expect(browser.history.pushState).toHaveBeenCalledTimes(1);
    expect(browser.entries).toHaveLength(2);
    expect(browser.entries[1]?.url).toBe('http://localhost/app/v/r34');
    expect(browser.entries[1]?.state).toMatchObject({ id: 'router-entry-1' });
  });

  it('a back closes the viewer, stays on the page and goes back no further', async () => {
    const onClose = jest.fn();
    const view = await renderUi(<Harness onClose={onClose} />);
    await browser.pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(browser.index()).toBe(0);
    expect(browser.history.back).toHaveBeenCalledTimes(1);
    // It leaves through its exit animation.
    await waitFor(() => expect(view.queryByTestId('v.counter')).toBeNull());
  });

  it('closed with its button, it takes its entry off again', async () => {
    const view = await renderUi(<Harness />);
    await fireEvent.press(view.getByTestId('v.close'));
    expect(browser.history.back).toHaveBeenCalledTimes(1);
    expect(browser.index()).toBe(0);
  });

  it('a viewer that is a route of its own pushes nothing', async () => {
    await renderUi(<Harness closeOnBrowserBack={false} />);
    expect(browser.history.pushState).not.toHaveBeenCalled();
  });
});
