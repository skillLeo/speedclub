<?php

namespace App\Enums;

/**
 * M5.8 staff actions on the forum (m5.8-contract §6), each written with Audit::record (before, after, reason, staff). Hiding a post and
 * the forum ban are DSA decisions and audit as `moderation.decided` through DecideCase.
 */
enum ForumAuditEvent: string
{
    case PostApproved = 'forum.post_approved';
    case PostRejected = 'forum.post_rejected';
    case ThreadPinned = 'forum.thread_pinned';
    case ThreadUnpinned = 'forum.thread_unpinned';
    case ThreadLocked = 'forum.thread_locked';
    case ThreadUnlocked = 'forum.thread_unlocked';
    case ThreadMoved = 'forum.thread_moved';
    case ThreadMerged = 'forum.thread_merged';
    case SolutionSet = 'forum.solution_set';
    case CategoryCreated = 'forum.category_created';
    case CategoryUpdated = 'forum.category_updated';
    case CategoryDeleted = 'forum.category_deleted';
    case CategoriesReordered = 'forum.categories_reordered';
    case CategoriesSynced = 'forum.categories_synced';
}
