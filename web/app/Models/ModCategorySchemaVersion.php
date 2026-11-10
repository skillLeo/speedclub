<?php

namespace App\Models;

use Database\Factories\ModCategorySchemaVersionFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One version of a modification category's field schema (M3.3, ADM-15): the whole list of fields after a change, archived ones included,
 * with who changed it and why. Version 1 is the state before the first admin change. Written only by App\Services\Catalog\SchemaVersions.
 *
 * @property int $category_id
 * @property int $version
 * @property list<array<string, mixed>> $schema
 * @property int|null $staff_id
 * @property string|null $reason
 * @property Carbon|null $created_at
 */
class ModCategorySchemaVersion extends Model
{
    /** @use HasFactory<ModCategorySchemaVersionFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'schema' => 'array',
        ];
    }

    /**
     * @return BelongsTo<ModCategory, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(ModCategory::class, 'category_id');
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function staff(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'staff_id');
    }
}
