/**
 * The real driver of the upload queue (src/state/uploads.ts): prepares on the device, sends through XMLHttpRequest and tells
 * the screens that a photo arrived. Kept apart from the queue, so the queue's rules can be tested with fakes.
 */
import * as Crypto from 'expo-crypto';

import { ApiError } from '@/api/client';
import { garageKeys } from '@/api/queries/garage';
import { uploadPhoto, type UploadTarget } from '@/api/queries/media';
import { modKeys } from '@/api/queries/mods';
import { myVehiclesKey } from '@/api/queries/profile';
import { queryClient } from '@/api/queryClient';
import i18n from '@/i18n';
import { AUTOMATIC_WAIT_MAX_S, type UploadDriver, type UploadFailure } from '@/state/uploads';

import { isKeyReused, waitText } from './errors';
import { photoForm, preparePhoto, releasePicked } from './photos';

/** A 429 without Retry-After. */
const DEFAULT_RATE_LIMIT_WAIT_S = 30;

/** What a tile says about a failure, and whether trying again can help. */
export function describeUploadError(error: unknown): UploadFailure {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return { message: i18n.t('garage:upload.network'), retryable: true, retryAfter: null, network: true };
    if (error.kind === 'rate_limited') {
      const wait = error.retryAfter ?? DEFAULT_RATE_LIMIT_WAIT_S;
      // The hourly upload allowance can name most of an hour: the queue does not poll that out, the member retries.
      if (wait > AUTOMATIC_WAIT_MAX_S) {
        const t = i18n.getFixedT(null, 'garage');
        return { message: t('upload.rateLimitedLong', { wait: waitText(t, wait) }), retryable: true, retryAfter: null, network: false };
      }
      return { message: i18n.t('garage:upload.rateLimited'), retryable: true, retryAfter: wait, network: false };
    }
    if (error.kind === 'conflict') {
      // 409 with Retry-After: the server is still busy with this photo's key, typically the automatic retry after a dropped
      // connection. A reused key: it was used for another file, and the same key can never pass.
      if (error.retryAfter !== null) return { message: i18n.t('garage:upload.inFlight'), retryable: true, retryAfter: error.retryAfter, network: false };
      return { message: isKeyReused(error) ? i18n.t('garage:upload.keyReused') : error.message, retryable: false, retryAfter: null, network: false };
    }
    if (error.status === 413) return { message: i18n.t('garage:upload.tooLarge'), retryable: false, retryAfter: null, network: false };
    if (error.status === 415) return { message: i18n.t('garage:upload.unsupported'), retryable: false, retryAfter: null, network: false };
    // A 422 names the file's problem, for example the storage allowance (ADR-146), in the member's language.
    if (error.kind === 'validation') {
      const message = error.fieldErrors.file?.[0] ?? Object.values(error.fieldErrors)[0]?.[0] ?? error.message;
      return { message, retryable: false, retryAfter: null, network: false };
    }
    if (error.kind === 'restricted' || error.kind === 'forbidden' || error.kind === 'not_found') {
      return { message: error.message, retryable: false, retryAfter: null, network: false };
    }
    return { message: i18n.t('garage:upload.server'), retryable: true, retryAfter: null, network: false };
  }
  // The device could not read or convert the photo.
  return { message: i18n.t('garage:upload.prepare'), retryable: false, retryAfter: null, network: false };
}

function refreshTarget(target: UploadTarget) {
  void queryClient.invalidateQueries({ queryKey: garageKeys.vehicle(target.vehicleId) });
  void queryClient.invalidateQueries({ queryKey: myVehiclesKey });
  // The public page and Verlauf are keyed by slug; their screens read again on focus, as after any edit.
  void queryClient.invalidateQueries({ queryKey: ['public-vehicle'] });
  if (target.kind === 'mod') {
    void queryClient.invalidateQueries({ queryKey: modKeys.mod(target.modId) });
    void queryClient.invalidateQueries({ queryKey: modKeys.list(target.vehicleId) });
  }
}

export function createGarageUploadDriver(): UploadDriver {
  return {
    prepare: preparePhoto,
    upload: async (target, preparedUri, idempotencyKey, onProgress, signal) =>
      uploadPhoto(target, await photoForm(preparedUri), idempotencyKey, onProgress, signal),
    onUploaded: (target) => refreshTarget(target),
    describe: describeUploadError,
    release: (item) => releasePicked(item.source),
    newId: () => Crypto.randomUUID(),
    now: () => Date.now(),
    schedule: (run, ms) => {
      setTimeout(run, ms);
    },
  };
}
