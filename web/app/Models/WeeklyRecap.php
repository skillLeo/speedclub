<?php

namespace App\Models;

use App\Enums\RecapStatus;
use Database\Factories\WeeklyRecapFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * M5.7 (10 §6.3, m5.7-contract §1.4): a member's recap of one ISO week (`week` = its Monday, Europe/Berlin): sent, skipped because nothing
 * happened, or unreachable. Unique per member and week, so the Sunday run never sends twice. Counts only; kept 12 weeks.
 *
 * @property int $id
 * @property string $user_id
 * @property string $week
 * @property RecapStatus $status
 * @property list<string>|null $channels
 * @property array<string, int>|null $payload
 */
#[Fillable(['user_id', 'week', 'status', 'channels', 'payload', 'created_at'])]
class WeeklyRecap extends Model
{
    /** @use HasFactory<WeeklyRecapFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['status' => RecapStatus::class, 'channels' => 'array', 'payload' => 'array'];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
