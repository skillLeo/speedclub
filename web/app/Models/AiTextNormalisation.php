<?php

namespace App\Models;

use Database\Factories\AiTextNormalisationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * M5.9 (10 §8.2, m5.9-contract §2.2): what the AI made of a typed part ("kw v3" → brand and product words), cached per normalised text
 * and category for `speedclub.ai.normalisation_cache_days`. The text alone, never who typed it.
 *
 * @property int $id
 * @property string $feature
 * @property string $cache_key
 * @property array{brand: string, terms: list<string>} $payload
 * @property Carbon $expires_at
 */
#[Fillable(['feature', 'cache_key', 'payload', 'created_at', 'expires_at'])]
class AiTextNormalisation extends Model
{
    /** @use HasFactory<AiTextNormalisationFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['payload' => 'array', 'expires_at' => 'datetime'];
    }
}
