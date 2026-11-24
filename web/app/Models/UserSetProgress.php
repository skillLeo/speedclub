<?php

namespace App\Models;

use Database\Factories\UserSetProgressFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * M5.9b (contract §1): a member's progress in one set (per year for a season set: `period`). Written by App\Services\Dex\DexSets.
 *
 * @property int $id
 * @property string $user_id
 * @property string $set_key
 * @property string $period
 * @property int $progress
 * @property int $target
 * @property Carbon|null $completed_at
 */
class UserSetProgress extends Model
{
    /** @use HasFactory<UserSetProgressFactory> */
    use HasFactory;

    public const CREATED_AT = null;

    protected $table = 'user_set_progress';

    protected $guarded = ['*'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'progress' => 'integer',
            'target' => 'integer',
            'completed_at' => 'datetime',
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
     * @return BelongsTo<DexSet, $this>
     */
    public function set(): BelongsTo
    {
        return $this->belongsTo(DexSet::class, 'set_key', 'key');
    }
}
