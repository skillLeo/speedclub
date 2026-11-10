<?php

namespace App\Models;

use Database\Factories\HelpArticleFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * SET-14 FAQ. One row per key and locale; the Phase 3 admin edits them (ADM-32). A locale without its own row falls back to German.
 *
 * @property int $id
 * @property string $key
 * @property string $locale
 * @property string|null $category
 * @property string $title
 * @property string $body_md
 * @property int $sort
 * @property bool $published
 */
#[Fillable(['key', 'locale', 'category', 'title', 'body_md', 'sort', 'published'])]
class HelpArticle extends Model
{
    /** @use HasFactory<HelpArticleFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'sort' => 'integer',
            'published' => 'boolean',
        ];
    }
}
