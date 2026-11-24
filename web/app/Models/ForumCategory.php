<?php

namespace App\Models;

use App\Enums\ForumCategoryKind;
use Database\Factories\ForumCategoryFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A forum category (10 §7.1, m5.8-contract §1): admin-managed and ordered, with one level of sub-categories. "Marken & Modelle" holds one
 * generated child per catalogue make (kind make), "Treffen & Regionen" one per Bundesland (kind region). Names in German and English;
 * the member API answers the reader's language. threads_count is for the admin only.
 *
 * @property int $id
 * @property int|null $parent_id
 * @property string $slug
 * @property ForumCategoryKind $kind
 * @property int|null $make_id
 * @property string|null $bundesland
 * @property string $name_de
 * @property string $name_en
 * @property string|null $description_de
 * @property string|null $description_en
 * @property string|null $icon
 * @property int $sort
 * @property bool $is_active
 * @property int $threads_count
 * @property ForumCategory|null $parent
 */
class ForumCategory extends Model
{
    /** @use HasFactory<ForumCategoryFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => ForumCategoryKind::class,
            'is_active' => 'boolean',
            'sort' => 'integer',
            'threads_count' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<ForumCategory, $this>
     */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    /**
     * @return HasMany<ForumCategory, $this>
     */
    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('sort')->orderBy('id');
    }

    /**
     * @return BelongsTo<Make, $this>
     */
    public function make(): BelongsTo
    {
        return $this->belongsTo(Make::class);
    }

    public function name(?string $locale = null): string
    {
        return ($locale ?? app()->getLocale()) === 'en' ? $this->name_en : $this->name_de;
    }

    public function description(?string $locale = null): ?string
    {
        return ($locale ?? app()->getLocale()) === 'en' ? $this->description_en : $this->description_de;
    }

    /**
     * Active itself and, for a sub-category, under an active parent.
     */
    public function isOpen(): bool
    {
        return $this->is_active && ($this->parent_id === null || $this->parent?->is_active === true);
    }
}
