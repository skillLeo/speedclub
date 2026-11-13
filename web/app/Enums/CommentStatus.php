<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * A comment on a build update [build_comments]. Visible to everybody who sees the update; removed by moderation (DSA decision, reversible
 * on appeal) shows to nobody but staff. Deleting by its author or the update's owner is a soft delete.
 */
enum CommentStatus: string
{
    use HasLabel;

    case Visible = 'visible';
    case Removed = 'removed';
}
