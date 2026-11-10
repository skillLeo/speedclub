<?php

namespace App\Models;

use Database\Factories\ModCategoryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Spatie\Translatable\HasTranslations;

/**
 * @property string $key
 */
#[Fillable(['key', 'name', 'icon', 'sort', 'active'])]
class ModCategory extends Model
{
    /** @use HasFactory<ModCategoryFactory> */
    use HasFactory, HasTranslations;

    /**
     * @var array<int, string>
     */
    public array $translatable = ['name'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'sort' => 'integer',
            'active' => 'boolean',
        ];
    }

    /**
     * @return HasMany<ModCategoryField, $this>
     */
    public function fields(): HasMany
    {
        return $this->hasMany(ModCategoryField::class, 'category_id');
    }

    /**
     * M3.3: every version of the field schema, oldest first.
     *
     * @return HasMany<ModCategorySchemaVersion, $this>
     */
    public function schemaVersions(): HasMany
    {
        return $this->hasMany(ModCategorySchemaVersion::class, 'category_id')->orderBy('version');
    }

    /**
     * @return HasMany<Modification, $this>
     */
    public function modifications(): HasMany
    {
        return $this->hasMany(Modification::class, 'category_id');
    }
}
