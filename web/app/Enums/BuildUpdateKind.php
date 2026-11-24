<?php

namespace App\Enums;

/**
 * M5.9c Build Journey (m5.9c contract §2): a plain post, or a before/after pair whose two photos (before, then after) follow through
 * POST build-updates/{id}/media and are paired in `photo_pairs`. Automatic entries and notes are `post`.
 */
enum BuildUpdateKind: string
{
    case Post = 'post';
    case BeforeAfter = 'before_after';
}
