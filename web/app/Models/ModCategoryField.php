<?php

namespace App\Models;

use App\Enums\ModFieldType;
use Database\Factories\ModCategoryFieldFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Spatie\Translatable\HasTranslations;

/**
 * @property ModFieldType $type
 * @property array<array-key, mixed>|null $options
 * @property float|null $min
 * @property float|null $max
 * @property float|null $step
 * @property bool $required
 * @property Carbon|null $archived_at
 */
#[Fillable(['category_id', 'key', 'label', 'type', 'unit', 'min', 'max', 'step', 'options', 'required', 'searchable', 'facet', 'sort'])]
class ModCategoryField extends Model
{
    /** @use HasFactory<ModCategoryFieldFactory> */
    use HasFactory, HasTranslations;

    /**
     * @var array<int, string>
     */
    public array $translatable = ['label'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => ModFieldType::class,
            'min' => 'float',
            'max' => 'float',
            'step' => 'float',
            'options' => 'array',
            'required' => 'boolean',
            'searchable' => 'boolean',
            'facet' => 'boolean',
            'sort' => 'integer',
            'archived_at' => 'datetime',
        ];
    }

    /**
     * Archived (M3.3, ADM-15): not offered for new entries, still shown and exported on existing modifications.
     */
    public function isArchived(): bool
    {
        return $this->archived_at !== null;
    }

    /**
     * @return BelongsTo<ModCategory, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(ModCategory::class, 'category_id');
    }
}
