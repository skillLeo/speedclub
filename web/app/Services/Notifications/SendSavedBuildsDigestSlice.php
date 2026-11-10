<?php

namespace App\Services\Notifications;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * One slice of the weekly saved-builds digest (SavedBuildsDigest::slice), then the next slice as a job of its own.
 */
class SendSavedBuildsDigestSlice implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    /**
     * @var list<int>
     */
    public array $backoff = [60, 300];

    public function __construct(
        // The ISO week, "2026-W45".
        public readonly string $weekId,
        // '' for the first slice.
        public readonly string $afterVehicleId = '',
    ) {}

    public function handle(SavedBuildsDigest $digest): void
    {
        $size = max(1, config()->integer('speedclub.notifications.digest_slice'));
        $last = $digest->slice($this->weekId, $this->afterVehicleId, $size);

        if ($last !== null) {
            self::dispatch($this->weekId, $last);
        }
    }
}
