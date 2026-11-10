<?php

namespace App\Models;

use App\Enums\TicketAuthorType;
use Database\Factories\TicketMessageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $ticket_id
 * @property TicketAuthorType $author_type
 * @property string $body
 * @property bool $internal M3.4: an internal note of the team, never sent
 * @property string|null $user_id
 * @property int|null $staff_id
 * @property Carbon|null $mailed_at
 * @property Carbon $created_at
 */
#[Fillable(['body'])]
class TicketMessage extends Model
{
    /** @use HasFactory<TicketMessageFactory> */
    use HasFactory, HasUlids;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['author_type' => TicketAuthorType::class, 'internal' => 'boolean', 'mailed_at' => 'datetime', 'created_at' => 'datetime'];
    }

    /**
     * @return BelongsTo<SupportTicket, $this>
     */
    public function ticket(): BelongsTo
    {
        return $this->belongsTo(SupportTicket::class, 'ticket_id');
    }
}
