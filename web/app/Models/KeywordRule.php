<?php

namespace App\Models;

use App\Enums\KeywordList;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A keyword of ADM-23 (m3.4-contract §1). `normalized` is what App\Services\Rules\KeywordNormaliser matches, unique across both lists.
 * Written only by App\Actions\Admin\Moderation\{AddKeywordRule,RemoveKeywordRule}; audited under the morph name `keyword_rule` (AdminServiceProvider).
 *
 * @property int $id
 * @property string $term
 * @property string $normalized
 * @property KeywordList $list
 * @property int|null $created_by
 */
class KeywordRule extends Model
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['list' => KeywordList::class];
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'created_by');
    }

    /**
     * @return HasMany<KeywordRuleHit, $this>
     */
    public function hits(): HasMany
    {
        return $this->hasMany(KeywordRuleHit::class);
    }
}
