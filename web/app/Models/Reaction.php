<?php

namespace App\Models;

use App\Enums\ReactionType;
use Database\Factories\ReactionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * A private reaction on a build or a build update (09 §8.5, ADR-413): one per member and item. Only the owner of the item ever sees who
 * reacted and how many did; anybody else sees their own reaction only.
 *
 * @property int $id
 * @property string $user_id
 * @property string $reactable_type
 * @property string $reactable_id
 * @property ReactionType $type
 */
#[Fillable(['user_id', 'reactable_type', 'reactable_id', 'type'])]
class Reaction extends Model
{
    /** @use HasFactory<ReactionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['type' => ReactionType::class];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return MorphTo<Model, $this>
     */
    public function reactable(): MorphTo
    {
        return $this->morphTo();
    }
}
