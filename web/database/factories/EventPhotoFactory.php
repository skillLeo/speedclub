<?php

namespace Database\Factories;

use App\Enums\GalleryPhotoSource;
use App\Enums\GalleryPhotoStatus;
use App\Enums\MediaCategory;
use App\Models\Event;
use App\Models\EventPhoto;
use App\Models\Media;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An approved attendee photo of a published event; its media belongs to the uploader and points at the photo (as an upload would).
 *
 * @extends Factory<EventPhoto>
 */
class EventPhotoFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'event_id' => Event::factory(),
            'uploader_id' => User::factory(),
            'media_id' => Media::factory()->state(['category' => MediaCategory::Event]),
            'source' => GalleryPhotoSource::Attendee,
            'status' => GalleryPhotoStatus::Approved,
            'reviewed_at' => now(),
            'sort' => 1,
            'is_sample' => false,
        ];
    }

    public function pending(): static
    {
        return $this->state(['status' => GalleryPhotoStatus::Pending, 'reviewed_at' => null, 'sort' => 0]);
    }

    public function configure(): static
    {
        return $this->afterCreating(function (EventPhoto $photo): void {
            Media::withTrashed()->whereKey($photo->media_id)->update([
                'owner_id' => $photo->uploader_id,
                'mediable_type' => $photo->getMorphClass(),
                'mediable_id' => $photo->id,
                'category' => MediaCategory::Event->value,
            ]);
        });
    }
}
