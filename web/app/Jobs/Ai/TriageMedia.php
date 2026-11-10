<?php

namespace App\Jobs\Ai;

use App\Models\Media;
use App\Services\Ai\Triage;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * ai.moderation_triage for a new public photo (AiServiceProvider: ready and attached to a vehicle, a modification or a profile, not yet
 * scored). Once per photo; one try.
 */
class TriageMedia implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 40;

    public int $uniqueFor = 3600;

    public function __construct(public readonly string $mediaId) {}

    public function uniqueId(): string
    {
        return $this->mediaId;
    }

    public function handle(Triage $triage): void
    {
        $photo = Media::query()->find($this->mediaId);

        if ($photo !== null && $photo->getAttribute('ai_scored_at') === null) {
            $triage->scoreMedia($photo);
        }
    }
}
