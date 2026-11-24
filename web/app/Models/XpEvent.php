<?php

namespace App\Models;

use App\Enums\XpType;
use Database\Factories\XpEventFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * M5.9d (m5.9d contract §1): one XP award, unique per member, type and source. Written by App\Services\Progress\Xp only; `capped` keeps
 * an award the daily cap reduced (to 0, or to what was left of the day) auditable.
 *
 * @property int $id
 * @property string $user_id
 * @property XpType $type
 * @property int $points
 * @property bool $capped
 * @property string $ref_type
 * @property string $ref_id
 * @property Carbon $day
 * @property Carbon|null $created_at
 */
class XpEvent extends Model
{
    /** @use HasFactory<XpEventFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    protected $guarded = ['id'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => XpType::class,
            'points' => 'integer',
            'capped' => 'boolean',
            'day' => 'date',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
