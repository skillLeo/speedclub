import { ApiError } from '@/api/client';
import type { StickerDesign, StickerOptions } from '@/api/queries/stickers';
import { AUTOSAVE_DELAY_MS, AutosaveQueue, type AutosaveEvent } from '@/features/qr/designer/autosave';
import type { DesignState } from '@/features/qr/designer/model';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));

const OPTIONS: StickerOptions = {
  size: 'm',
  colourway: 'white',
  material: 'transparent',
  qr: true,
  username: true,
  car_name: false,
  custom_line: null,
  mirrored: false,
};
const BASE: DesignState = { template: 'classic', options: OPTIONS };
const state = (patch: Partial<StickerOptions>, template: DesignState['template'] = 'classic'): DesignState => ({
  template,
  options: { ...OPTIONS, ...patch },
});

type SaveInput = { baseVersion: number; baseRevision?: number; state: DesignState; keepalive?: boolean };

function saved(input: SaveInput, version = Math.max(1, input.baseVersion), revision = (input.baseRevision ?? 0) + 1): StickerDesign {
  return {
    revision,
    id: '01design',
    persisted: true as unknown as string,
    reference: 'SD7H2KQXMB',
    version,
    template: input.state.template,
    options: input.state.options,
    effective: { username: true, car_name: false, custom_line: false },
    size_mm: { width: 156, height: 65 },
    qr_mm: 35.7,
    state: 'draft',
    scan_test: null,
    validated_at: null,
    order_requested_at: null,
    code: null,
    warnings: [],
    urls: { preview_svg: null, share_png: null, print_svg: null, print_pdf: null, print_png: null },
    created_at: null,
    updated_at: null,
  };
}

const apiError = (status: number, code: string, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ kind: status === 0 ? 'network' : 'server', status, code, message: code, ...extra });

function setup(save: jest.Mock, version = 3, revision = 5) {
  const events: AutosaveEvent[] = [];
  const queue = new AutosaveQueue({ version, revision, ...BASE }, save, (event) => events.push(event));
  const statuses = () => events.filter((event) => event.type === 'status').map((event) => (event as { status: string }).status);
  return { queue, events, statuses };
}

/** Lets the save promise settle under fake timers. */
async function settle() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('STK-05 autosave (contract §3.1)', () => {
  it('waits for the pause after the last change, then sends one PUT with the version it last saw', async () => {
    const save = jest.fn(async (input: SaveInput) => saved(input));
    const { queue, statuses } = setup(save);
    queue.change(state({ size: 's' }));
    queue.change(state({ size: 'l' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toEqual({ baseVersion: 3, baseRevision: 5, state: state({ size: 'l' }), keepalive: false });
    expect(statuses()).toEqual(['pending', 'saving', 'saved']);
  });

  it('sends nothing when the editor returns to the saved state (undo back to it)', () => {
    const save = jest.fn();
    const { queue } = setup(save);
    queue.change(state({ size: 's' }));
    queue.change(BASE);
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
    expect(queue.status).toBe('saved');
  });

  it('keeps one save in flight and sends a change made meanwhile right after, on the new version', async () => {
    let resolve: (design: StickerDesign) => void = () => undefined;
    const save = jest
      .fn()
      .mockImplementationOnce((input) => new Promise<StickerDesign>((done) => (resolve = () => done(saved(input, 4)))))
      .mockImplementation(async (input) => saved(input, 4));
    const { queue } = setup(save);
    queue.change(state({ size: 's' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    queue.change(state({ size: 'l' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    resolve(saved({ baseVersion: 3, state: state({ size: 's' }) }, 4));
    await settle();
    jest.advanceTimersByTime(0);
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toMatchObject({ baseVersion: 4, baseRevision: 6, state: state({ size: 'l' }) });
  });

  it('stops on 409 edit_conflict, keeps the member’s state and sends it on top of the newer version only when asked', async () => {
    const save = jest.fn().mockRejectedValueOnce(apiError(409, 'edit_conflict')).mockImplementation(async (input) => saved(input, 8));
    const { queue } = setup(save);
    queue.change(state({ colourway: 'black' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();
    expect(queue.status).toBe('conflict');
    expect(queue.unsaved).toBe(true);
    // More edits while the dialog is open are kept, not sent.
    queue.change(state({ colourway: 'black', size: 'l' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3);
    expect(save).toHaveBeenCalledTimes(1);

    queue.resolveConflict({ version: 7, revision: 12, ...state({ qr: false }) }, true);
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toMatchObject({ baseVersion: 7, baseRevision: 12, state: state({ colourway: 'black', size: 'l' }) });
  });

  it('drops the member’s state when the newer version is loaded instead', async () => {
    const save = jest.fn().mockRejectedValueOnce(apiError(409, 'edit_conflict'));
    const { queue } = setup(save);
    queue.change(state({ colourway: 'black' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();
    queue.resolveConflict({ version: 7, revision: 12, ...state({ qr: false }) }, false);
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.status).toBe('saved');
    expect(queue.version).toBe(7);
  });

  it('hands a refused field (422 content_blocked) to the screen and waits for the next change', async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce(apiError(422, 'content_blocked', { fieldErrors: { 'options.custom_line': ['Diese Zeile können wir nicht drucken.'] } }))
      .mockImplementation(async (input) => saved(input));
    const { queue, events } = setup(save);
    queue.change(state({ custom_line: 'blocked words' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();
    expect(queue.status).toBe('invalid');
    expect(events).toContainEqual({
      type: 'invalid',
      code: 'content_blocked',
      message: 'content_blocked',
      fieldErrors: { 'options.custom_line': ['Diese Zeile können wir nicht drucken.'] },
    });
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3);
    expect(save).toHaveBeenCalledTimes(1);
    queue.change(state({ custom_line: 'Built not bought' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('keeps the state offline and sends it when the connection is back', async () => {
    const save = jest.fn().mockRejectedValueOnce(apiError(0, 'network')).mockImplementation(async (input) => saved(input));
    const { queue } = setup(save);
    queue.change(state({ size: 's' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();
    expect(queue.status).toBe('offline');
    expect(queue.unsaved).toBe(true);
    queue.resume();
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(queue.status).toBe('saved');
  });

  it('tries again after a server error, with the server’s Retry-After', async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce(apiError(429, 'too_many_requests', { retryAfter: 5 }))
      .mockImplementation(async (input) => saved(input));
    const { queue } = setup(save);
    queue.change(state({ size: 's' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();
    expect(queue.status).toBe('pending');
    jest.advanceTimersByTime(4999);
    expect(save).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('never writes for a suspended owner (403)', async () => {
    const save = jest.fn().mockRejectedValue(apiError(403, 'account_suspended'));
    const { queue } = setup(save);
    queue.change(state({ size: 's' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();
    expect(queue.status).toBe('forbidden');
    queue.change(state({ size: 'l' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves the untouched default before the Scan-Test, because the test needs a stored version', async () => {
    const save = jest.fn(async (input: SaveInput) => saved(input, 1));
    const { queue } = setup(save, 0);
    await queue.ensureSaved(BASE);
    expect(save).toHaveBeenCalledWith({ baseVersion: 0, baseRevision: 5, state: BASE, keepalive: false });
    expect(queue.version).toBe(1);
    await queue.ensureSaved(BASE);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('keeps a change that waits when the Scan-Test rebases the queue, and still sends it (review MF-1)', async () => {
    const save = jest.fn(async (input: SaveInput) => saved(input, 3));
    const { queue } = setup(save);
    queue.change(state({ size: 'l' }));
    // The validate answer arrives before the pause is over.
    queue.rebase({ version: 3, revision: 5, ...BASE });
    expect(queue.unsaved).toBe(true);
    expect(queue.status).toBe('pending');
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toMatchObject({ baseVersion: 3, baseRevision: 5, state: state({ size: 'l' }) });
    // A rebase onto the content that waits drops nothing and sends nothing.
    queue.change(state({ size: 's' }));
    queue.rebase({ version: 4, revision: 1, ...state({ size: 's' }) });
    expect(queue.unsaved).toBe(false);
  });

  it('carries the draft revision: sends it as base_revision and takes the answer’s (review MF-4)', async () => {
    const save = jest.fn(async (input: SaveInput) => saved(input, 3, 9));
    const { queue } = setup(save);
    queue.change(state({ size: 's' }));
    await queue.flush();
    expect(save.mock.calls[0]![0]).toMatchObject({ baseRevision: 5 });
    expect(queue.revision).toBe(9);
    queue.change(state({ size: 'l' }));
    await queue.flush();
    expect(save.mock.calls[1]![0]).toMatchObject({ baseRevision: 9 });
  });

  it('flush waits for the save on its way and then sends the change made meanwhile (review MF-2)', async () => {
    let finish: () => void = () => undefined;
    const save = jest
      .fn()
      .mockImplementationOnce((input: SaveInput) => new Promise<StickerDesign>((done) => (finish = () => done(saved(input, 3, 6)))))
      .mockImplementation(async (input: SaveInput) => saved(input, 3, 7));
    const { queue } = setup(save);
    queue.change(state({ size: 's' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    queue.change(state({ size: 'l' }));
    const flushed = queue.flush();
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await flushed;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toMatchObject({ baseVersion: 3, baseRevision: 6, state: state({ size: 'l' }) });
    expect(queue.unsaved).toBe(false);
  });

  it('still sends the waiting change when the screen goes during a save, without talking to the screen (review MF-2)', async () => {
    let finish: () => void = () => undefined;
    const save = jest
      .fn()
      .mockImplementationOnce((input: SaveInput) => new Promise<StickerDesign>((done) => (finish = () => done(saved(input)))))
      .mockImplementation(async (input: SaveInput) => saved(input));
    const { queue, events } = setup(save);
    queue.change(state({ size: 's' }));
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    queue.change(state({ size: 'l' }));
    const closed = queue.close();
    const heard = events.length;
    finish();
    await closed;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toMatchObject({ state: state({ size: 'l' }) });
    expect(events).toHaveLength(heard);
  });

  it('asks the browser to keep the request alive when the page is left (review SF-2)', async () => {
    const save = jest.fn(async (input: SaveInput) => saved(input));
    const { queue } = setup(save);
    queue.change(state({ size: 's' }));
    await queue.flush({ keepalive: true });
    expect(save.mock.calls[0]![0]).toMatchObject({ keepalive: true });
    // Back on the page: later saves are normal requests again (re-check nit).
    queue.change(state({ size: 'l' }));
    await queue.flush();
    expect(save.mock.calls[1]![0]).toMatchObject({ keepalive: false });
  });

  it('stops a flush at a failed save instead of trying again at once', async () => {
    const save = jest.fn().mockRejectedValue(apiError(503, 'unavailable'));
    const { queue } = setup(save);
    queue.change(state({ size: 's' }));
    await queue.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.status).toBe('pending');
  });
});
