<?php

namespace App\Models;

use App\Enums\BadgeCategory;
use App\Enums\BadgeTier;
use Database\Factories\BadgeFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * M5.9d (m5.9d contract §2): a badge with its fixed rule (App\Services\Badges\BadgeRules validates rule_json). Seeded by BadgeSeeder,
 * edited through the admin badge manager's actions (App\Actions\Admin\Badges). A hidden badge shows "???" and its hint until earned.
 *
 * @property string $key
 * @property string $name_de
 * @property string $name_en
 * @property string $description_de
 * @property string $description_en
 * @property string|null $hint_de
 * @property string|null $hint_en
 * @property array<string, mixed> $rule_json
 * @property bool $hidden
 * @property BadgeTier $tier
 * @property BadgeCategory $category
 * @property int $sort
 * @property bool $active
 */
class Badge extends Model
{
    /** @use HasFactory<BadgeFactory> */
    use HasFactory;

    protected $primaryKey = 'key';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'rule_json' => 'array',
            'hidden' => 'boolean',
            'tier' => BadgeTier::class,
            'category' => BadgeCategory::class,
            'sort' => 'integer',
            'active' => 'boolean',
        ];
    }

    public function name(?string $locale = null): string
    {
        return self::english($locale) ? $this->name_en : $this->name_de;
    }

    public function description(?string $locale = null): string
    {
        return self::english($locale) ? $this->description_en : $this->description_de;
    }

    public function hint(?string $locale = null): ?string
    {
        return self::english($locale) ? $this->hint_en : $this->hint_de;
    }

    private static function english(?string $locale): bool
    {
        return ($locale ?? app()->getLocale()) === 'en';
    }
}
