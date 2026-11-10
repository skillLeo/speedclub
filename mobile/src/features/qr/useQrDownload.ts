import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/api/client';
import i18n from '@/i18n';

import { downloadQr, type QrDownloadOutcome, type QrFormat } from './download';

export type QrDownloadState = {
  /** The format on its way, or null. One download at a time. */
  active: QrFormat | null;
  /** 0 to 1, or null while the size is unknown. */
  progress: number | null;
  /** The last failure, by format: shown on that row until the next try. */
  error: { format: QrFormat; error: ApiError } | null;
};

const IDLE: QrDownloadState = { active: null, progress: null, error: null };

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** downloadQr only rejects with ApiError; anything else still reaches the member as plain words, never as a raw message. */
function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError({ kind: 'server', status: 0, code: 'server', message: i18n.t('errors:server') });
}

/**
 * The download sheet's controller: one transfer at a time, progress for the row, the failure kept on its row, and a cancel
 * when the sheet closes or the screen goes. `onDone` runs after the hand-over (share sheet or browser download), `onFailed`
 * once per failure.
 */
export function useQrDownload(
  target: { vehicleId: string; code: string; dialogTitle?: string },
  onDone: (outcome: QrDownloadOutcome, format: QrFormat) => void,
  onFailed?: (error: ApiError, format: QrFormat) => void,
) {
  const [state, setState] = useState<QrDownloadState>(IDLE);
  const controller = useRef<AbortController | null>(null);
  const latestDone = useRef(onDone);
  const latestFailed = useRef(onFailed);
  useEffect(() => {
    latestDone.current = onDone;
    latestFailed.current = onFailed;
  });

  const mutation = useMutation({
    mutationFn: ({ format, signal }: { format: QrFormat; signal: AbortSignal }) =>
      downloadQr({
        ...target,
        format,
        signal,
        onProgress: (progress) => setState((current) => (current.active === format ? { ...current, progress } : current)),
      }),
    networkMode: 'always',
  });
  const { mutateAsync } = mutation;

  const start = useCallback(
    async (format: QrFormat) => {
      if (controller.current) return;
      const abort = new AbortController();
      controller.current = abort;
      setState({ active: format, progress: null, error: null });
      // A cancelled transfer can settle after the next one started: from then on the state and the controller are that
      // one's, and what the old one reports is ignored.
      const current = () => controller.current === abort;
      try {
        const outcome = await mutateAsync({ format, signal: abort.signal });
        if (!current()) return;
        setState(IDLE);
        latestDone.current(outcome, format);
      } catch (error) {
        if (!current()) return;
        if (isAbort(error) || abort.signal.aborted) setState(IDLE);
        else {
          const failure = asApiError(error);
          setState({ active: null, progress: null, error: { format, error: failure } });
          latestFailed.current?.(failure, format);
        }
      } finally {
        if (current()) controller.current = null;
      }
    },
    [mutateAsync],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState(IDLE);
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  return { ...state, start, cancel };
}
