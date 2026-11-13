<?php

namespace App\Actions\Events;

use App\Models\Event;
use App\Models\Media;
use App\Models\User;
use App\Services\Media\MediaService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * The cover of an event (EVT-03 "Cover", 16:9 on EVT-02). Through MediaService like every upload: re-encoded, EXIF/GPS stripped,
 * WebP variants, blurhash, private original. A new cover replaces the old one, whose files go. Not while the event is in review; a new
 * cover of a published event that needed pre-moderation sends it back to review (UpdateEvent::reviewAgainIfNeeded).
 */
class UploadEventCover
{
    public function __construct(
        private readonly MediaService $media,
        private readonly UpdateEvent $update,
    ) {}

    /**
     * @param  array{alt?: string|null, focal_x?: float|null, focal_y?: float|null}  $attributes
     */
    public function handle(User $user, Event $event, UploadedFile $file, array $attributes): Media
    {
        $bytes = $this->media->inspectUpload($file);

        [$reserved, $previous] = DB::transaction(function () use ($user, $event, $attributes, $bytes): array {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            /** @var Event $locked */
            $locked = Event::query()->whereKey($event->id)->lockForUpdate()->firstOrFail();

            // Security review SEC-412-01: no new cover while staff review the event; a pre-moderated published event goes back to review.
            UpdateEvent::assertEditable($locked);

            $previous = $locked->getAttribute('cover_media_id');
            $media = $this->media->reserve($user, $locked, $attributes, strlen($bytes));
            $locked->forceFill(['cover_media_id' => $media->id]);
            $this->update->reviewAgainIfNeeded($locked, ['cover']);
            $locked->save();

            return [$media, is_string($previous) ? $previous : null];
        });

        $processed = $this->media->processOrQueue($reserved, $bytes);

        if ($previous !== null && ($old = Media::withTrashed()->find($previous)) instanceof Media) {
            $this->media->purge($old);
        }

        return $processed;
    }
}
