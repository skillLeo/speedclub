<?php

namespace App\Models;

use App\Enums\ApproverChangeCause;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A staff action took approval rights from someone who held `approvals.decide` (SEC-P5-01, ADR-507). Written only by
 * App\Services\Approvals\ApproverChanges; the Owner-Override waits its cool-down after the latest row.
 *
 * @property int $id
 * @property int $staff_id
 * @property ApproverChangeCause $cause
 * @property int|null $changed_by
 * @property Carbon $created_at
 */
class ApproverChange extends Model
{
    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'staff_id' => 'integer',
            'changed_by' => 'integer',
            'cause' => ApproverChangeCause::class,
            'created_at' => 'datetime',
        ];
    }
}
