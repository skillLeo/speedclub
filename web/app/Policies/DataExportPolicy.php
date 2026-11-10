<?php

namespace App\Policies;

use App\Models\DataExport;
use App\Models\User;

/**
 * SET-12. Open under every restriction (GDPR Art. 15 and 20): only a closed account has nothing to export any more.
 */
class DataExportPolicy
{
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function create(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function view(User $user, DataExport $export): bool
    {
        return ! $user->isDeactivated() && $export->user_id === $user->id;
    }
}
