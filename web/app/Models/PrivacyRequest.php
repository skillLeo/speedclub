<?php

namespace App\Models;

use App\Enums\PrivacyRequestSource;
use App\Enums\PrivacyRequestStatus;
use App\Enums\PrivacyRequestType;
use Database\Factories\PrivacyRequestFactory;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A GDPR request handled by the team (ADM-45/46, 08_LEGAL_COMPLIANCE, Art. 12 GDPR). due_at is one month after received_at; one
 * extension by two more months, with a reason (PrivacyDeadlines). Only the Privacy Actions write it. Members' own SET-12/SET-13
 * requests are not rows here: PrivacyRequests::selfService() lists them from the audit log.
 *
 * @property string $id
 * @property PrivacyRequestType $type
 * @property PrivacyRequestStatus $status
 * @property PrivacyRequestSource $source
 * @property string|null $user_id
 * @property string|null $requester_name
 * @property string|null $requester_email
 * @property string $locale
 * @property string|null $details
 * @property Carbon $received_at
 * @property Carbon $due_at
 * @property Carbon|null $extended_at
 * @property string|null $extension_reason
 * @property int|null $assigned_to
 * @property int|null $created_by
 * @property int|null $completed_by
 * @property Carbon|null $completed_at
 * @property string|null $evidence_note
 * @property string|null $evidence_path
 * @property string|null $evidence_name
 * @property string|null $data_export_id
 * @property string|null $approval_request_id
 * @property Carbon|null $last_reply_at
 * @property-read User|null $member
 * @property-read Staff|null $assignee
 */
#[Hidden(['evidence_path'])]
class PrivacyRequest extends Model
{
    /** @use HasFactory<PrivacyRequestFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => PrivacyRequestType::class,
            'status' => PrivacyRequestStatus::class,
            'source' => PrivacyRequestSource::class,
            'received_at' => 'datetime',
            'due_at' => 'datetime',
            'extended_at' => 'datetime',
            'completed_at' => 'datetime',
            'last_reply_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function member(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id')->withTrashed();
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function assignee(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'assigned_to');
    }

    /**
     * @return BelongsTo<DataExport, $this>
     */
    public function dataExport(): BelongsTo
    {
        return $this->belongsTo(DataExport::class);
    }

    /**
     * @return BelongsTo<ApprovalRequest, $this>
     */
    public function approval(): BelongsTo
    {
        return $this->belongsTo(ApprovalRequest::class, 'approval_request_id');
    }

    /** Where replies go: the member's account address, else the address the requester gave. */
    public function replyAddress(): ?string
    {
        $member = $this->member;

        if ($member instanceof User && ! $member->trashed() && $member->email !== '') {
            return $member->email;
        }

        return $this->requester_email;
    }
}
