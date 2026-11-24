<?php

namespace App\Models;

use App\Enums\DexSetKind;
use Database\Factories\DexSetFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * M5.9b (contract §1, §3): a STREET DEX set. rule_json by kind: jdm {generations: [[make, model, generation], …]}, brand {make, tiers},
 * city {target}, season {target}; season sets carry their month-day window. Read by App\Services\Dex\DexSets.
 *
 * @property string $key
 * @property string $name_de
 * @property string $name_en
 * @property DexSetKind $kind
 * @property array<string, mixed> $rule_json
 * @property string|null $starts_on
 * @property string|null $ends_on
 * @property bool $hidden
 * @property int $sort
 */
#[Fillable(['key', 'name_de', 'name_en', 'kind', 'rule_json', 'starts_on', 'ends_on', 'hidden', 'sort'])]
class DexSet extends Model
{
    /** @use HasFactory<DexSetFactory> */
    use HasFactory;

    protected $primaryKey = 'key';

    protected $keyType = 'string';

    public $incrementing = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => DexSetKind::class,
            'rule_json' => 'array',
            'hidden' => 'boolean',
            'sort' => 'integer',
        ];
    }

    public function name(?string $locale = null): string
    {
        return ($locale ?? app()->getLocale()) === 'en' ? $this->name_en : $this->name_de;
    }
}
