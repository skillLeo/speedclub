<?php

namespace App\Models;

use App\Enums\LegalDocumentKey;
use Database\Factories\LegalDocumentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property LegalDocumentKey $key
 * @property int $id
 * @property string $locale
 * @property string $version
 * @property string $body_md
 * @property bool $requires_reconsent
 * @property string|null $summary
 * @property Carbon|null $published_at
 * @property int|null $created_by
 * @property int|null $published_by
 * @property string|null $reason
 */
#[Fillable(['key', 'locale', 'version', 'body_md', 'requires_reconsent', 'summary', 'published_at', 'created_by', 'published_by', 'reason'])]
class LegalDocument extends Model
{
    /** @use HasFactory<LegalDocumentFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'key' => LegalDocumentKey::class,
            'requires_reconsent' => 'boolean',
            'published_at' => 'datetime',
        ];
    }
}
