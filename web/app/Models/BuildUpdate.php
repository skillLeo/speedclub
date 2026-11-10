<?php

namespace App\Models;

use App\Enums\BuildUpdateType;
use Database\Factories\BuildUpdateFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property bool $hidden
 * @property BuildUpdateType $type
 * @property array<string, mixed>|null $payload
 * @property Vehicle $vehicle
 */
#[Fillable(['type', 'payload', 'note', 'hidden'])]
class BuildUpdate extends Model
{
    /** @use HasFactory<BuildUpdateFactory> */
    use HasFactory, HasUlids;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => BuildUpdateType::class,
            'payload' => 'array',
            'hidden' => 'boolean',
            'open_until' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class)->withTrashed();
    }
}
