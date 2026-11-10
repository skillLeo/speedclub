// BH-41: a list on the member web keeps its place while its screen is hidden, through the short list FlashList measures on the way back.
import { renderHook } from '@testing-library/react-native';
import type { RefObject } from 'react';

import { useRetainedListScroll, type RetainedList } from '@/features/shell/useRetainedListScroll';

const mockPlatform = { isWeb: true };
jest.mock('@/lib/platform', () => ({
  get isWeb() {
    return mockPlatform.isWeb;
  },
}));

const mockFocus: { effect: (() => void | (() => void)) | null; cleanup: (() => void) | void } = { effect: null, cleanup: undefined };
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    mockFocus.effect = effect;
  },
}));

const focus = () => {
  mockFocus.cleanup = mockFocus.effect?.();
};
const blur = () => {
  mockFocus.cleanup?.();
  mockFocus.cleanup = undefined;
};
const FRAME = 16;
const frames = (count: number) => jest.advanceTimersByTime(count * FRAME);

/** A browser's scroller: the offset is clamped to the content, and a hidden one has no height and reads 0. */
class FakeScroller {
  clientHeight = 800;
  scrollHeight = 9700;
  private offset = 0;
  private listeners = new Map<string, Set<() => void>>();

  get scrollTop() {
    return this.clientHeight === 0 ? 0 : this.offset;
  }
  set scrollTop(value: number) {
    this.offset = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
    this.emit('scroll');
  }
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  /** Hidden by display:none. */
  hide() {
    this.clientHeight = 0;
    this.scrollHeight = 0;
    this.offset = 0;
  }
  /** Back on show, FlashList's measured stages. */
  show(scrollHeight: number) {
    this.clientHeight = 800;
    this.scrollHeight = scrollHeight;
    this.offset = Math.min(this.offset, Math.max(0, scrollHeight - 800));
  }
}

async function setup(options: { ignoresScrollCalls?: boolean } = {}) {
  const node = new FakeScroller();
  const scrollToOffset = jest.fn(({ offset }: { offset: number }) => {
    if (!options.ignoresScrollCalls) node.scrollTop = offset;
  });
  const listRef: RefObject<RetainedList | null> = { current: { scrollToOffset, getScrollableNode: () => node } };
  const { result } = await renderHook(() => useRetainedListScroll(listRef));
  focus();
  return { node, scrollToOffset, result };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockPlatform.isWeb = true;
  mockFocus.effect = null;
  mockFocus.cleanup = undefined;
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => setTimeout(() => callback(Date.now()), FRAME) as unknown as number);
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));
});
afterEach(() => {
  blur();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('useRetainedListScroll', () => {
  it('puts the list back through the stages FlashList passes when its screen returns', async () => {
    const { node, scrollToOffset } = await setup();
    node.scrollTop = 3000;

    blur();
    node.hide();
    frames(10);
    focus();
    // Still hidden for a moment: nothing to scroll yet.
    frames(2);
    expect(scrollToOffset).not.toHaveBeenCalled();

    // Short at first, so the browser clamps.
    node.show(2252);
    frames(3);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 3000, animated: false });
    expect(node.scrollTop).toBe(1452);

    // Measured: the full height, and the offset back at 0.
    node.show(9700);
    node.scrollTop = 0;
    frames(3);
    expect(node.scrollTop).toBe(3000);
  });

  it('holds on after the place is reached, for a reset that comes late', async () => {
    const { node } = await setup();
    node.scrollTop = 300;
    blur();
    node.hide();
    focus();
    node.show(2252);
    frames(3);
    expect(node.scrollTop).toBe(300);

    node.show(9700);
    node.scrollTop = 0;
    frames(3);
    expect(node.scrollTop).toBe(300);
  });

  it('writes the offset itself where the browser ignores the call on a list that was hidden', async () => {
    const { node, scrollToOffset } = await setup({ ignoresScrollCalls: true });
    node.scrollTop = 3000;
    blur();
    node.hide();
    focus();
    node.show(9700);
    frames(2);
    expect(scrollToOffset).toHaveBeenCalled();
    expect(node.scrollTop).toBe(3000);
  });

  it('takes no scroll event of a hidden list for the place', async () => {
    const { node } = await setup();
    node.scrollTop = 3000;
    node.hide();
    node.emit('scroll');
    blur();
    focus();
    node.show(9700);
    frames(2);
    expect(node.scrollTop).toBe(3000);
  });

  it('stops once the place has held, and follows the member from there', async () => {
    const { node, scrollToOffset } = await setup();
    node.scrollTop = 3000;
    blur();
    node.hide();
    focus();
    node.show(9700);
    frames(40);
    scrollToOffset.mockClear();

    node.scrollTop = 500;
    frames(40);
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(node.scrollTop).toBe(500);

    blur();
    node.hide();
    focus();
    node.show(9700);
    frames(2);
    expect(node.scrollTop).toBe(500);
  });

  it('leaves the list to a member who scrolls during the restore', async () => {
    const { node } = await setup();
    node.scrollTop = 3000;
    blur();
    node.hide();
    focus();
    node.show(9700);
    frames(2);

    node.emit('wheel');
    node.scrollTop = 2800;
    frames(40);
    expect(node.scrollTop).toBe(2800);
  });

  it('gives up on a list that stays too short, and stays where it can', async () => {
    const { node, scrollToOffset } = await setup();
    node.scrollTop = 3000;
    blur();
    node.hide();
    focus();
    node.show(2000);
    frames(200);
    expect(node.scrollTop).toBe(1200);
    scrollToOffset.mockClear();
    frames(20);
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it('forgets the place on a jump to the top, also in the middle of a restore', async () => {
    const { node, result } = await setup();
    node.scrollTop = 3000;
    result.current.forget();
    node.scrollTop = 0;
    blur();
    node.hide();
    focus();
    node.show(9700);
    frames(40);
    expect(node.scrollTop).toBe(0);

    node.scrollTop = 1500;
    blur();
    node.hide();
    focus();
    node.show(9700);
    frames(2);
    expect(node.scrollTop).toBe(1500);
    result.current.forget();
    node.scrollTop = 0;
    frames(40);
    expect(node.scrollTop).toBe(0);
  });

  // RESULT 9: a screen that shows a state first mounts its list after the focus; the node is looked up again.
  it('follows a list that mounts after the first focus, with no render of the screen in between', async () => {
    const node = new FakeScroller();
    const scrollToOffset = jest.fn(({ offset }: { offset: number }) => {
      node.scrollTop = offset;
    });
    const listRef: RefObject<RetainedList | null> = { current: null };
    await renderHook(() => useRetainedListScroll(listRef));
    focus();
    frames(3);

    listRef.current = { scrollToOffset, getScrollableNode: () => node };
    frames(2);
    node.scrollTop = 3000;
    blur();
    node.hide();
    focus();
    node.show(9700);
    frames(2);
    expect(node.scrollTop).toBe(3000);
  });

  it('follows a list whose scroll node is still missing at focus and arrives with a render of the screen', async () => {
    const node = new FakeScroller();
    let mounted = false;
    const listRef: RefObject<RetainedList | null> = {
      current: { scrollToOffset: jest.fn(), getScrollableNode: () => (mounted ? node : null) },
    };
    const view = await renderHook(() => useRetainedListScroll(listRef));
    focus();

    mounted = true;
    await view.rerender(undefined);
    node.scrollTop = 1500;
    blur();
    node.hide();
    focus();
    node.show(9700);
    frames(2);
    expect(node.scrollTop).toBe(1500);
  });

  it('moves over to a scroller FlashList put in place of the first one, and keeps the place', async () => {
    const first = new FakeScroller();
    const second = new FakeScroller();
    let node = first;
    const listRef: RefObject<RetainedList | null> = {
      current: {
        scrollToOffset: jest.fn(({ offset }: { offset: number }) => {
          node.scrollTop = offset;
        }),
        getScrollableNode: () => node,
      },
    };
    const view = await renderHook(() => useRetainedListScroll(listRef));
    focus();
    first.scrollTop = 800;

    node = second;
    await view.rerender(undefined);
    frames(40);
    // The place recorded on the first scroller is put back on the second.
    expect(second.scrollTop).toBe(800);
    second.scrollTop = 3000;
    first.scrollTop = 100;
    blur();
    second.hide();
    focus();
    second.show(9700);
    frames(2);
    expect(second.scrollTop).toBe(3000);
  });

  it('does nothing on native, where a covered screen keeps its layout', async () => {
    mockPlatform.isWeb = false;
    const { node, scrollToOffset } = await setup();
    node.scrollTop = 3000;
    blur();
    node.hide();
    focus();
    node.show(9700);
    frames(40);
    expect(scrollToOffset).not.toHaveBeenCalled();
  });
});
