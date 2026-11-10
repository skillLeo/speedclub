/**
 * The words of a conversation that several screens repeat: the other member's name ("Gelöschtes Mitglied" for a deleted account,
 * contract §1), the inbox preview ("Foto", "Fahrzeug", "Du: …"), and the photo aspect of a message.
 */
import type { TFunction } from 'i18next';

import type { PhotoAspect } from '@/ui';

import { memberName, type ConversationSummary, type MessagePreview } from './model';

export function otherName(conversation: Pick<ConversationSummary, 'other' | 'otherDeleted'>, t: TFunction): string {
  if (!conversation.other || conversation.otherDeleted) return t('deletedMember');
  return memberName(conversation.other);
}

/** "@jann.ptrs", or nothing for a deleted account. */
export function otherHandle(conversation: Pick<ConversationSummary, 'other' | 'otherDeleted'>): string | null {
  return conversation.other && !conversation.otherDeleted ? `@${conversation.other.username}` : null;
}

/** One line: the text, "Foto" or "Fahrzeug", with "Du: " before your own. Line breaks fold to spaces. */
export function previewText(preview: MessagePreview | null, t: TFunction): string {
  if (!preview) return t('preview.none');
  const text =
    preview.kind === 'photo' ? t('preview.photo') : preview.kind === 'vehicle' ? t('preview.vehicle') : (preview.body ?? '').replace(/\s+/g, ' ').trim();
  return preview.mine ? t('preview.mine', { text }) : text;
}

/** §7 ratios only: wide shots 16:9, ordinary landscape 4:3, square 1:1, portrait 9:16. The focal point keeps the subject. */
export function photoAspect(width: number | null | undefined, height: number | null | undefined): PhotoAspect {
  if (!width || !height) return '4:3';
  const ratio = width / height;
  if (ratio >= 1.6) return '16:9';
  if (ratio >= 1.15) return '4:3';
  if (ratio >= 0.85) return '1:1';
  return '9:16';
}

/** The thread allows 2000 characters per text (contract §2). */
export const MESSAGE_MAX_LENGTH = 2000;

/** The first `max` characters as the server counts them (code points), so an emoji is never cut in half (review 17). */
export function takeChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}
