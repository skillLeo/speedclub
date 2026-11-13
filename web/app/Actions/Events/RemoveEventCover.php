<?php

namespace App\Actions\Events;

use App\Models\Event;
use App\Models\Media;
use App\Services\Media\MediaService;
use Illuminate\Support\Facades\DB;

/**
 * EVT-03 "Cover entfernen": the organiser takes the cover off. Not while the event is in review, nor once it is over, cancelled or removed
 * (UpdateEvent::assertEditable). Taking a photo away adds nothing staff would have to see again, so a published event stays published.
 * The photo's files go after the commit. Idempotent: an event without a cover answers the same.
 */
class RemoveEventCover
{
    public function __construct(private readonly MediaService $media) {}

    public function handle(Event $event): Event
    {
        $previous = DB::transaction(function () use ($event): ?string {
            /** @var Event $locked */
            $locked = Event::query()->whereKey($event->id)->lockForUpdate()->firstOrFail();
            UpdateEvent::assertEditable($locked);

            $previous = $locked->getAttribute('cover_media_id');
            $locked->forceFill(['cover_media_id' => null])->save();

            return is_string($previous) ? $previous : null;
        });

        if ($previous !== null && ($old = Media::withTrashed()->find($previous)) instanceof Media) {
            $this->media->purge($old);
        }

        return $event->refresh();
    }
}
