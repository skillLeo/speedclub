<?php

namespace App\Models;

use App\Enums\SupportCategory;
use App\Enums\SupportTicketSource;
use App\Enums\SupportTicketStatus;
use Database\Factories\SupportTicketFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * SET-15 (member) and WEB-10 (guest). ADM-25 answers them in Phase 3. Kept 24 months (06_ADMIN_SPEC §4).
 *
 * @property string $id
 * @property string|null $user_id
 * @property SupportTicketSource $source
 * @property SupportCategory $category
 * @property SupportTicketStatus $status
 * @property int|null $assigned_staff_id M3.4 (ADM-25)
 * @property Carbon|null $last_activity_at M3.4: last message or note, for the queue order
 * @property Carbon|null $closed_at
 */
#[Fillable(['category', 'subject', 'name', 'email', 'locale'])]
class SupportTicket extends Model
{
    /** @use HasFactory<SupportTicketFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'source' => SupportTicketSource::class,
            'category' => SupportCategory::class,
            'status' => SupportTicketStatus::class,
            'closed_at' => 'datetime',
            'last_activity_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function assignedStaff(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'assigned_staff_id');
    }

    /**
     * @return HasMany<TicketMessage, $this>
     */
    public function messages(): HasMany
    {
        return $this->hasMany(TicketMessage::class, 'ticket_id');
    }
}
