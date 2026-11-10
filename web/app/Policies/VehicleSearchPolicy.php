<?php

namespace App\Policies;

use App\Models\User;
use App\Models\VehicleSearch;

/**
 * Read-only projection. Queries filter on is_public and blocks themselves; this answers for a single row.
 */
class VehicleSearchPolicy
{
    public function viewAny(?User $user): bool
    {
        return true;
    }

    public function view(?User $user, VehicleSearch $row): bool
    {
        return $row->is_public && $row->vehicle !== null && (new VehiclePolicy)->view($user, $row->vehicle);
    }
}
