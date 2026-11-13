<?php

namespace App\Models;

use App\Enums\CollectionItemType;
use Database\Factories\MemberCollectionItemFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An entry of a member collection. Lists show the highest position first; something the member can no longer see stays stored and is
 * left out while that lasts, as saved builds always were.
 *
 * @property int $id
 * @property string $collection_id
 * @property CollectionItemType $item_type
 * @property string $item_id
 * @property int $position
 */
#[Fillable(['collection_id', 'item_type', 'item_id', 'position'])]
class MemberCollectionItem extends Model
{
    /** @use HasFactory<MemberCollectionItemFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['item_type' => CollectionItemType::class, 'position' => 'integer'];
    }

    /**
     * @return BelongsTo<MemberCollection, $this>
     */
    public function collection(): BelongsTo
    {
        return $this->belongsTo(MemberCollection::class, 'collection_id');
    }
}
