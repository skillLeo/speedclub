<?php

namespace App\Policies;

use App\Models\HelpArticle;
use App\Models\User;

/**
 * SET-14 is readable signed out; drafts are for the Phase 3 admin only.
 */
class HelpArticlePolicy
{
    public function viewAny(?User $user): bool
    {
        return true;
    }

    public function view(?User $user, HelpArticle $article): bool
    {
        return $article->published;
    }
}
