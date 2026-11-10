<?php

namespace App\Models;

use App\Enums\IllegalSubReason;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use Database\Factories\ReportFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A notice (Art. 16 DSA, m2.6-contract §1): from a member in the app or from anybody through WEB-09. Written only by
 * App\Actions\Moderation\SubmitReport; never logged (its details, contact and evidence are personal data).
 *
 * evidence (encrypted): {"target": {…a snapshot of the reported text…}, "messages": [{id, from, type, body, media_id, vehicle_id,
 * created_at, reported}]} — messages only for a message target: the reported one and up to 5 before and after it.
 *
 * @property string $id
 * @property string|null $reporter_id
 * @property string $case_id
 * @property ReportSource $source
 * @property ReportTargetType $target_type
 * @property string $target_id
 * @property string|null $target_label
 * @property ReportReason $reason
 * @property IllegalSubReason|null $sub_reason
 * @property string|null $details
 * @property string|null $contact_name
 * @property string|null $contact_email
 * @property string|null $contact_locale
 * @property bool $good_faith
 * @property array<string, mixed>|null $evidence
 * @property Carbon $created_at
 */
class Report extends Model
{
    /** @use HasFactory<ReportFactory> */
    use HasFactory, HasUlids;

    public const UPDATED_AT = null;

    /** Personal data: never in a serialised model (a log context, a dump). */
    protected $hidden = ['details', 'contact_name', 'contact_email', 'evidence'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'source' => ReportSource::class,
            'target_type' => ReportTargetType::class,
            'reason' => ReportReason::class,
            'sub_reason' => IllegalSubReason::class,
            'good_faith' => 'boolean',
            'evidence' => 'encrypted:array',
            'created_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<ModerationCase, $this>
     */
    public function case(): BelongsTo
    {
        return $this->belongsTo(ModerationCase::class, 'case_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function reporter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporter_id')->withTrashed();
    }
}
