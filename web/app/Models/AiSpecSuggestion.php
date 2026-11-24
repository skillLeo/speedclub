<?php

namespace App\Models;

use Database\Factories\AiSpecSuggestionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * M5.9 (10 §8.1, m5.9-contract §2.1): the AI's typical factory specs for one catalogue generation (or a model and year without
 * generations), shared by every member who picks it. Catalogue names in, numbers and enum values out: no member data. Expires after
 * `speedclub.ai.spec_cache_days`; staff can delete a wrong one from the catalogue (DeleteAiSpecSuggestions).
 *
 * @property string $id
 * @property int|null $generation_id
 * @property int|null $model_id
 * @property int|null $model_year
 * @property string $cache_key
 * @property list<array{key: string, label: string, fields: array<string, string|int|float>}> $payload
 * @property string|null $ai_call_id
 * @property Carbon|null $created_at
 * @property Carbon $expires_at
 */
#[Fillable(['generation_id', 'model_id', 'model_year', 'cache_key', 'payload', 'ai_call_id', 'created_at', 'expires_at'])]
class AiSpecSuggestion extends Model
{
    /** @use HasFactory<AiSpecSuggestionFactory> */
    use HasFactory, HasUlids;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['payload' => 'array', 'expires_at' => 'datetime', 'model_year' => 'integer'];
    }

    /**
     * @return BelongsTo<Generation, $this>
     */
    public function generation(): BelongsTo
    {
        return $this->belongsTo(Generation::class);
    }
}
