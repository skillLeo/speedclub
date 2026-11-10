<?php

namespace App\Console\Commands;

use App\Actions\Media\SweepDetachedMedia;
use App\Enums\MediaStatus;
use App\Models\Media;
use App\Services\Media\MediaService;
use App\Services\Messaging\ChatMediaJanitor;
use App\Services\Privacy\RetentionPolicy;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Throwable;

#[Signature('media:prune')]
#[Description('Take back the photos of what was deleted, hard-delete orphaned uploads and unused message photos and media past the soft-delete grace period, fail stuck uploads, remove old failed ones')]
class PruneMediaCommand extends Command
{
    /** Keeps one cron run well below the 50 s window; the rest waits for the next day. */
    private const BATCH = 500;

    public function handle(MediaService $media, SweepDetachedMedia $sweep, ChatMediaJanitor $chatMedia): int
    {
        // First: a request that died after deleting a vehicle left its photos public. Later steps count on them being soft-deleted.
        $detached = $sweep->handle(self::BATCH);

        $orphans = Media::query()
            ->whereNull('mediable_id')
            ->where('created_at', '<', now()->subHours(config()->integer('speedclub.media.orphan_prune_hours')))
            ->limit(self::BATCH)
            ->get();

        // M2.4: a chat photo no message took within unused_photo_hours, and a sent one nobody sees any more (review #5). Each is checked
        // again right before its purge, so a photo a message claims in between stays (review #23).
        $unusedPhotos = $chatMedia->unused(self::BATCH);
        $unseenPhotos = $chatMedia->unseen(self::BATCH);
        $this->eachSafely($unusedPhotos, fn (Media $photo) => $chatMedia->stillUnused($photo) ? $media->purge($photo) : null);
        $this->eachSafely($unseenPhotos, fn (Media $photo) => $media->purge($photo));

        $deleted = Media::onlyTrashed()
            ->where('deleted_at', '<', now()->subDays(app(RetentionPolicy::class)->value('deleted_media_days')))
            ->limit(self::BATCH)
            ->get();

        $this->eachSafely($orphans->concat($deleted), $media->purge(...));

        // Deleted, but the storage hiccuped when the public files should have gone (or the request died first).
        $leftovers = Media::onlyTrashed()->whereNotNull('variants')->limit(self::BATCH)->get();

        $this->eachSafely($leftovers, $media->withdraw(...));

        // The host killed the request and no retry was queued. Otherwise these would count towards the limit forever.
        $stuck = Media::query()
            ->where('status', MediaStatus::Processing)
            ->where('created_at', '<', now()->subHours(config()->integer('speedclub.media.orphan_prune_hours')))
            ->limit(self::BATCH)
            ->get();

        $this->eachSafely($stuck, $media->markFailed(...));

        // Their owner had time to see them on GAR-07 and to delete them. They hold no files any more, only a row.
        $failed = Media::query()
            ->where('status', MediaStatus::Failed)
            ->where('updated_at', '<', now()->subDays(config()->integer('speedclub.media.failed_prune_days')))
            ->limit(self::BATCH)
            ->get();

        $this->eachSafely($failed, $media->purge(...));

        $this->info("Took back {$detached} photos of deleted vehicles and mods. Pruned {$orphans->count()} orphaned, {$unusedPhotos->count()} unused and {$unseenPhotos->count()} unseen chat photos, {$deleted->count()} deleted and {$failed->count()} failed media, {$stuck->count()} stuck uploads failed.");

        return self::SUCCESS;
    }

    /**
     * One row that keeps failing is reported and must not stop the rest, or the whole command would stand still on it every day.
     *
     * @param  iterable<Media>  $items
     * @param  callable(Media): mixed  $step
     */
    private function eachSafely(iterable $items, callable $step): void
    {
        foreach ($items as $item) {
            try {
                $step($item);
            } catch (Throwable $exception) {
                report($exception);
            }
        }
    }
}
