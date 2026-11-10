<?php

namespace App\Models;

use App\Enums\ConfigVersionStatus;
use Database\Factories\ConfigVersionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One version of a runtime config key (App\Enums\ConfigKey, App\Services\Config\ConfigVersions).
 *
 * @property int $id
 * @property string $key
 * @property int $version
 * @property ConfigVersionStatus $status
 * @property int $revision
 * @property int|null $base_version
 * @property array<string, mixed> $payload
 * @property int|null $created_by
 * @property int|null $published_by
 * @property Carbon|null $published_at
 * @property string|null $reason
 * @property Carbon|null $updated_at
 */
#[Fillable(['key', 'version', 'status', 'revision', 'base_version', 'payload', 'created_by', 'published_by', 'published_at', 'reason'])]
class ConfigVersion extends Model
{
    /** @use HasFactory<ConfigVersionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'revision' => 'integer',
            'base_version' => 'integer',
            'status' => ConfigVersionStatus::class,
            'payload' => 'array',
            'published_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'created_by');
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function publisher(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'published_by');
    }
}
