<?php

namespace App\Models;

use Database\Factories\BusinessViewDayFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Views of a business profile per day (BIZ-03 "Profilaufrufe 30 Tage", private to the business team): a number only, no viewer, no
 * address, no cookie (like qr_scan_daily).
 *
 * @property int $id
 * @property string $business_id
 * @property string $day
 * @property int $views
 */
class BusinessViewDay extends Model
{
    /** @use HasFactory<BusinessViewDayFactory> */
    use HasFactory;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = ['business_id', 'day', 'views'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['views' => 'integer'];
    }

    /**
     * @return BelongsTo<Business, $this>
     */
    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
