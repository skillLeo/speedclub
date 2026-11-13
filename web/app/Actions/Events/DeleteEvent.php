<?php

namespace App\Actions\Events;

use App\Enums\CollectionItemType;
use App\Enums\ErrorCode;
use App\Enums\EventStatus;
use App\Exceptions\ApiException;
use App\Models\Event;
use App\Models\Media;
use App\Services\Media\MediaService;
use App\Services\PublicPages\SitemapWriter;
use App\Services\Social\Collections;
use Illuminate\Support\Facades\DB;

/**
 * The organiser deletes an event: a draft, one waiting for review, a rejected, cancelled or past one, with its cover, answers and
 * updates. An upcoming published event with answers is cancelled first (409 conflict), so attendees learn about it.
 */
class DeleteEvent
{
    public function __construct(private readonly MediaService $media, private readonly SitemapWriter $sitemap) {}

    public function handle(Event $event): void
    {
        $photos = DB::transaction(function () use ($event) {
            /** @var Event $locked */
            $locked = Event::query()->whereKey($event->id)->lockForUpdate()->firstOrFail();

            if ($locked->status === EventStatus::Published && ! $locked->hasEnded() && $locked->rsvps()->whereNull('removed_at')->exists()) {
                throw new ApiException(ErrorCode::Conflict, (string) __('events.cancel_first'));
            }

            $photos = Media::withTrashed()->where('mediable_type', $locked->getMorphClass())->where('mediable_id', $locked->id)->get();
            $locked->delete();
            // No collection points at an event that is gone (09 §8.6).
            Collections::forgetItem(CollectionItemType::Event, $locked->id);

            return $photos;
        });

        foreach ($photos as $photo) {
            $this->media->purge($photo);
        }

        // M4.16: a public event's page /e/{slug} is gone; the sitemap must not list it until the night.
        if ($event->status->isPublic()) {
            $this->sitemap->forget();
        }
    }
}
