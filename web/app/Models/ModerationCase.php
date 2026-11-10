<?php

namespace App\Models;

use App\Enums\CaseOrigin;
use App\Enums\CaseStatus;
use App\Enums\ReportTargetType;
use Database\Factories\ModerationCaseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Carbon;

/**
 * One case per target while it is open (new, in review): further reports join it (ADM-20). open_target is "<type>:<id>" while open and
 * null afterwards, under a unique index. subject_id is the member the case is about.
 *
 * @property string $id
 * @property ReportTargetType $target_type
 * @property string $target_id
 * @property CaseOrigin $origin report (M2.6) or staff (an own-initiative case, M3.2)
 * @property string|null $target_label names the target of an own-initiative case; a reported case uses its first report's label
 * @property string|null $open_target
 * @property string|null $subject_id
 * @property CaseStatus $status
 * @property int $priority
 * @property int $report_count
 * @property string|null $ai_score
 * @property string|null $ai_summary
 * @property int|null $assigned_staff_id
 * @property int $reason_weight M3.4: highest reason weight of the reports (priority part)
 * @property int $reporter_count M3.4: distinct reporters (priority part)
 * @property bool $automated M3.4: a keyword rule of the flag list filed the first report
 * @property string|null $appeal_id M3.4: the overturned appeal this case records the outcome of
 * @property Carbon|null $decided_at
 * @property Carbon|null $ai_scored_at M3.7: when ai.moderation_triage last scored the case (ai_score = risk_score / 100, ai_summary = risk_reason)
 * @property bool $ai_detected M3.7: the case's detection came from the triage (a staff case on a photo it flagged), DSA Art. 17(3)(c)
 */
class ModerationCase extends Model
{
    /** @use HasFactory<ModerationCaseFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'target_type' => ReportTargetType::class,
            'status' => CaseStatus::class,
            'origin' => CaseOrigin::class,
            'priority' => 'integer',
            'report_count' => 'integer',
            'reason_weight' => 'integer',
            'reporter_count' => 'integer',
            'automated' => 'boolean',
            'decided_at' => 'datetime',
            'ai_scored_at' => 'datetime',
            'ai_detected' => 'boolean',
        ];
    }

    public function isOwnInitiative(): bool
    {
        return $this->origin === CaseOrigin::Staff;
    }

    public static function openKey(ReportTargetType $type, string $id): string
    {
        return $type->value.':'.$id;
    }

    /**
     * @return HasMany<Report, $this>
     */
    public function reports(): HasMany
    {
        return $this->hasMany(Report::class, 'case_id');
    }

    /**
     * The first report: its label names the target in SET-16 and SAFE-01.
     *
     * @return HasOne<Report, $this>
     */
    public function firstReport(): HasOne
    {
        return $this->hasOne(Report::class, 'case_id')->oldestOfMany();
    }

    /**
     * @return HasOne<Decision, $this>
     */
    public function decision(): HasOne
    {
        return $this->hasOne(Decision::class, 'case_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'subject_id')->withTrashed();
    }

    /**
     * M3.4: the appeal whose outcome this case records.
     *
     * @return BelongsTo<Appeal, $this>
     */
    public function appeal(): BelongsTo
    {
        return $this->belongsTo(Appeal::class);
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function assignedStaff(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'assigned_staff_id');
    }
}
