<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.8 (m5.8-contract §1): a post (a thread's opening post or a reply) waits for pre-moderation, is published, was rejected there, or
 * was removed by a DSA decision (reversible on appeal). Deleting by its author is a soft delete.
 */
enum ForumPostStatus: string
{
    use HasLabel;

    case Pending = 'pending';
    case Published = 'published';
    case Rejected = 'rejected';
    case Removed = 'removed';
}
