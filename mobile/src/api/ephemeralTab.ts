/**
 * Tabs whose data must never reach this browser's storage: a view-as tab (m3.2-contract §3, a member's data in a staff browser) and a
 * draft preview tab (ADM-34, ADR-236 c: the admin's iframe shows unpublished drafts, and anything written here would show as live in the
 * next normal tab of the same browser — code review M3.3-app MF-A). Such a tab neither restores nor writes the query cache, and keeps
 * announcement dismissals in memory.
 */
import { isViewAsTab } from './clientViewAs';
import { previewToken } from './preview';

export function keepsNothingOnDisk(): boolean {
  return isViewAsTab() || previewToken() !== null;
}
