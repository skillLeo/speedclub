<?php

namespace App\Models;

use App\Enums\ViewSource;
use App\Enums\ViewSubject;
use Database\Factories\ViewDayFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * M5.7 (10 §6.1, m5.7-contract §1.3): unique viewers of a public profile or vehicle per Europe/Berlin day and source, written together
 * with the raw event (App\Services\Insights\ViewRecorder). A number only: no viewer, address or device. INS-01, the weekly recap and the
 * badge metric `views_received` read these rows; they go with the vehicle or the account.
 *
 * @property int $id
 * @property ViewSubject $subject_type
 * @property string $subject_id
 * @property string $owner_id
 * @property string|null $vehicle_id
 * @property string $day
 * @property ViewSource $source
 * @property int $views
 */
#[Fillable(['subject_type', 'subject_id', 'owner_id', 'vehicle_id', 'day', 'source', 'views'])]
class ViewDay extends Model
{
    /** @use HasFactory<ViewDayFactory> */
    use HasFactory;

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['subject_type' => ViewSubject::class, 'source' => ViewSource::class, 'views' => 'integer'];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }
}
