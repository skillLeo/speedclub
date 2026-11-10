<?php

namespace App\Models;

use App\Enums\CatalogRequestStatus;
use Database\Factories\CatalogRequestFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A member's "Nicht gefunden?" entry, reviewed in ADM-14.
 *
 * @property string|null $user_id
 * @property CatalogRequestStatus $status
 */
#[Fillable(['vehicle_id', 'make_text', 'model_text', 'generation_text'])]
class CatalogRequest extends Model
{
    /** @use HasFactory<CatalogRequestFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => CatalogRequestStatus::class,
            'resolved_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function resolvedBy(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'resolved_by');
    }
}
