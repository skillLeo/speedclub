<?php

namespace App\Policies;

use App\Models\LegalDocument;
use App\Models\User;

/**
 * Published versions are public, drafts are for staff only.
 */
class LegalDocumentPolicy
{
    public function viewAny(?User $user): bool
    {
        return true;
    }

    public function view(?User $user, LegalDocument $document): bool
    {
        return $document->published_at !== null && $document->published_at->isPast();
    }
}
