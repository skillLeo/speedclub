import { CODE_LENGTH } from './schemas';

/** What a typed, pasted or autofilled value holds: digits, at most six. A pasted "123 456" counts as a code. */
export function sanitizeCode(text: string): string {
  return text.replace(/\D/g, '').slice(0, CODE_LENGTH);
}
