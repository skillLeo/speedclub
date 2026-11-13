<?php

namespace App\Models;

use Database\Factories\MemberCollectionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A member's private collection (09 §8.6, COL-01/02): the default "Gespeichert" (name null until renamed) and named ones. Always private:
 * nobody but the member reads it, and nothing about it reaches the owners of what it holds.
 *
 * @property string $id
 * @property string $user_id
 * @property string|null $name
 * @property bool $is_default
 * @property int $position
 */
#[Fillable(['name', 'position'])]
class MemberCollection extends Model
{
    /** @use HasFactory<MemberCollectionFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['is_default' => 'boolean', 'position' => 'integer'];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return HasMany<MemberCollectionItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(MemberCollectionItem::class, 'collection_id');
    }

    /**
     * What the app shows: the member's own name, or "Gespeichert" / "Saved" for the default collection they never renamed.
     */
    public function displayName(?string $locale = null): string
    {
        $name = $this->getAttribute('name');

        return is_string($name) && $name !== '' ? $name : (string) __('social.collections.default_name', [], $locale);
    }
}
