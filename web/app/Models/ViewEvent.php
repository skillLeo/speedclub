<?php

namespace App\Models;

use App\Enums\ViewSource;
use App\Enums\ViewSubject;
use Database\Factories\ViewEventFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * M5.7 (10 §6.1, m5.7-contract §1.2): one counted view per viewer, subject and Europe/Berlin day. The viewer is only a hash keyed with the
 * day's salt (App\Services\Insights\ViewSalts), which is deleted when the day is over; there is no IP, user agent, user or device
 * column, and no time of day (only the Berlin day). Kept `insights.raw_retention_days` (90) by day, then pruned (views:prune); the daily numbers live on in view_days. Never exposed.
 *
 * @property int $id
 * @property ViewSubject $subject_type
 * @property string $subject_id
 * @property string $owner_id
 * @property string|null $vehicle_id
 * @property string $day
 * @property ViewSource $source
 * @property string $viewer_hash
 */
#[Fillable(['subject_type', 'subject_id', 'owner_id', 'vehicle_id', 'day', 'source', 'viewer_hash'])]
class ViewEvent extends Model
{
    /** @use HasFactory<ViewEventFactory> */
    use HasFactory;

    /** SF-2: no time of day at all, only the Berlin day. */
    public $timestamps = false;

    /** @var list<string> */
    protected $hidden = ['viewer_hash'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['subject_type' => ViewSubject::class, 'source' => ViewSource::class];
    }
}
