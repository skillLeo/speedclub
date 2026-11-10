<?php

namespace App\Models;

use App\Enums\TranslationSource;
use Database\Factories\AiTranslationFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * The 30-day cache of ai.translate: per source, target language and the SHA-256 of the source text, so an edited source is translated
 * anew. The text is encrypted (it may be a message). Read only after the access check of the source (TranslateText).
 *
 * @property string $id
 * @property TranslationSource $source_type
 * @property string $source_id
 * @property string $to
 * @property string $source_hash
 * @property string $text
 * @property Carbon $expires_at
 */
class AiTranslation extends Model
{
    /** @use HasFactory<AiTranslationFactory> */
    use HasFactory, HasUlids;

    public const UPDATED_AT = null;

    /** Never in a serialised model. */
    protected $hidden = ['text'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'source_type' => TranslationSource::class,
            'text' => 'encrypted',
            'expires_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }
}
