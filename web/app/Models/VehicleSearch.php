<?php

namespace App\Models;

use App\Enums\Drivetrain;
use App\Enums\Fuel;
use App\Enums\Gearbox;
use Database\Factories\VehicleSearchFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Search projection, rebuilt by a job after any vehicle, spec, mod or media change (05_ARCHITECTURE §6).
 *
 * @property bool $is_public
 */
#[Table('vehicle_search', key: 'vehicle_id', keyType: 'string', incrementing: false)]
#[Fillable([
    'vehicle_id', 'owner_id', 'make_id', 'model_id', 'generation_id', 'model_year', 'power_ps', 'drivetrain', 'gearbox',
    'fuel', 'wheel_diameter', 'wheel_brand_id', 'suspension_type', 'suspension_brand_id', 'exhaust_brand_id',
    'mod_category_mask', 'search_text', 'title_keys', 'search_keys', 'is_public', 'published_at', 'rank_score',
])]
class VehicleSearch extends Model
{
    /** @use HasFactory<VehicleSearchFactory> */
    use HasFactory;

    public const CREATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'model_year' => 'integer',
            'power_ps' => 'float',
            'drivetrain' => Drivetrain::class,
            'gearbox' => Gearbox::class,
            'fuel' => Fuel::class,
            'wheel_diameter' => 'float',
            'mod_category_mask' => 'integer',
            'is_public' => 'boolean',
            'published_at' => 'datetime',
            'rank_score' => 'float',
        ];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }
}
