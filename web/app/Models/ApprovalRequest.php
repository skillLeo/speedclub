<?php

namespace App\Models;

use App\Enums\ApprovalStatus;
use Database\Factories\ApprovalRequestFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A four-eyes request (ADR-214). Written only by App\Services\Approvals\Approvals; nothing executes from the row itself.
 *
 * @property string $id
 * @property string $action
 * @property string|null $subject_type
 * @property string|null $subject_id
 * @property array<string, mixed> $payload
 * @property array{title: string, subject_label: string|null, lines: list<array{label: string, before?: string|null, after?: string|null}>} $summary
 * @property string $reason
 * @property int $requested_by
 * @property ApprovalStatus $status
 * @property string|null $pending_key
 * @property int|null $decided_by
 * @property Carbon|null $decided_at
 * @property string|null $decision_comment
 * @property Carbon $expires_at
 * @property Carbon|null $executed_at
 * @property array<string, mixed>|null $result
 * @property-read Staff|null $requester
 * @property-read Staff|null $decider
 */
class ApprovalRequest extends Model
{
    /** @use HasFactory<ApprovalRequestFactory> */
    use HasFactory, HasUlids;

    protected $hidden = ['payload', 'pending_key'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'payload' => 'encrypted:array',
            'summary' => 'array',
            'result' => 'array',
            'status' => ApprovalStatus::class,
            'requested_by' => 'integer',
            'decided_by' => 'integer',
            'decided_at' => 'datetime',
            'expires_at' => 'datetime',
            'executed_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function requester(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'requested_by');
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function decider(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'decided_by');
    }

    public function isPending(): bool
    {
        return $this->status === ApprovalStatus::Pending;
    }

    public function hasExpired(): bool
    {
        return ! $this->expires_at->isFuture();
    }
}
