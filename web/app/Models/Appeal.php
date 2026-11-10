<?php

namespace App\Models;

use App\Enums\AppealStatus;
use App\Enums\DecisionViewer;
use Database\Factories\AppealFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * An internal complaint against a decision (Art. 20 DSA): by the affected member or by a reporter of the case, one per person and
 * decision. Decided in Phase 3 (ADM-24) by a staff member other than the decider. The text is never logged.
 *
 * @property string $id
 * @property string $decision_id
 * @property string|null $appellant_id
 * @property DecisionViewer $role
 * @property string $text
 * @property AppealStatus $status
 * @property string|null $outcome_explanation M3.4: what the deciding staff member wrote to the appellant
 * @property int|null $decided_by
 * @property Carbon|null $decided_at
 * @property Carbon $created_at
 */
class Appeal extends Model
{
    /** @use HasFactory<AppealFactory> */
    use HasFactory, HasUlids;

    protected $hidden = ['text', 'outcome_explanation'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'role' => DecisionViewer::class,
            'status' => AppealStatus::class,
            'decided_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Decision, $this>
     */
    public function decision(): BelongsTo
    {
        return $this->belongsTo(Decision::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function appellant(): BelongsTo
    {
        return $this->belongsTo(User::class, 'appellant_id')->withTrashed();
    }
}
