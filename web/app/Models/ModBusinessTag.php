<?php

namespace App\Models;

use App\Enums\ModTagInitiator;
use App\Enums\ModTagStatus;
use Carbon\CarbonImmutable;
use Database\Factories\ModBusinessTagFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * "Eingebaut von" (09 §8.10, ADR-414): a business named on a mod. Whoever asked first (initiated_by), the other side confirms; only
 * then (accepted) the mod carries installed_by_business_id and the build appears in the business's portfolio. Either side removes it
 * (the row goes). One tag per mod.
 *
 * @property string $id
 * @property string $mod_id
 * @property string $business_id
 * @property ModTagStatus $status
 * @property ModTagInitiator $initiated_by
 * @property string|null $requested_by
 * @property string|null $decided_by
 * @property CarbonImmutable|null $decided_at
 * @property-read Modification|null $modification
 * @property-read Business $business
 */
class ModBusinessTag extends Model
{
    /** @use HasFactory<ModBusinessTagFactory> */
    use HasFactory, HasUlids;

    /** @var list<string> */
    protected $fillable = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => ModTagStatus::class,
            'initiated_by' => ModTagInitiator::class,
            'decided_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Modification, $this>
     */
    public function modification(): BelongsTo
    {
        return $this->belongsTo(Modification::class, 'mod_id');
    }

    /**
     * @return BelongsTo<Business, $this>
     */
    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }
}
