import { ApiError } from '@/api/client';
import { BUSINESS_CODES } from '@/api/queries/businesses';

type Translate = (key: 'tags.taken' | 'tags.notVerified' | 'tags.failed') => string;

/**
 * The toast of a failed "Eingebaut von" call (GAR-10, VEH-02, BIZ-04): our words for the answers we know, among them SEC-414's 409
 * business_tag_taken (another business's confirmed tag is never replaced), the server's own sentence for the rest.
 */
export function tagErrorText(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError)) return t('tags.failed');
  if (error.code === BUSINESS_CODES.tagTaken) return t('tags.taken');
  if (error.code === BUSINESS_CODES.notVerified) return t('tags.notVerified');
  return error.message || t('tags.failed');
}
