<?php

namespace App\Models;

use App\Enums\GalleryPhotoSource;
use App\Enums\GalleryPhotoStatus;
use Carbon\CarbonImmutable;
use Database\Factories\EventPhotoFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * M5.6 (10 §4, m5.6-contract §4.1): a photo of an event's gallery. The picture is a member upload (Media of category `event`, mediable =
 * this row, owner = the uploader), so re-encoding, EXIF stripping, variants, blurhash and the plate blur of ADR-509 are the pipeline's.
 * An attendee's photo waits for the organiser (pending); the organiser's own publish at once. Status, review and removal columns are not
 * fillable: only App\Actions\Events\Gallery change them.
 *
 * @property string $id
 * @property string $event_id
 * @property string $media_id
 * @property string $uploader_id
 * @property GalleryPhotoSource $source
 * @property GalleryPhotoStatus $status
 * @property string|null $reviewed_by
 * @property CarbonImmutable|null $reviewed_at
 * @property string|null $reject_reason
 * @property int|null $removed_by_staff_id
 * @property int $sort
 * @property bool $is_sample
 * @property CarbonImmutable|null $created_at
 * @property-read Event $event
 * @property-read Media $media
 * @property-read User $uploader
 */
class EventPhoto extends Model
{
    /** @use HasFactory<EventPhotoFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    /** @var list<string> */
    protected $fillable = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'source' => GalleryPhotoSource::class,
            'status' => GalleryPhotoStatus::class,
            'reviewed_at' => 'immutable_datetime',
            'sort' => 'integer',
            'is_sample' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Event, $this>
     */
    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    /**
     * @return BelongsTo<Media, $this>
     */
    public function media(): BelongsTo
    {
        return $this->belongsTo(Media::class)->withTrashed();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploader_id');
    }

    public function isUploadedBy(?User $user): bool
    {
        return $user !== null && $this->uploader_id === $user->id;
    }
}
