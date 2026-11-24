<?php

namespace App\Services\Crews;

use App\Enums\CrewStatus;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Models\Crew;
use App\Models\Media;
use App\Services\Media\MediaService;
use Closure;

/**
 * The DSA side of a crew (contract-crews.md §6): ContentRemoval hides it (status hidden: out of every list and page but its own members')
 * and takes its logo and cover off the public disk (SF-11: rejected, the private originals stay, so staff reveal them on the case through
 * ADM-13's audited "Anzeigen"). ContentRestoration brings back the status it had and draws the pictures again from the originals
 * (ADR-123). A crew staff deleted afterwards (RemoveCrew) is restored to hidden by RestoreCrew, never here: a reversal of the hiding
 * decision on a deleted crew leaves it deleted.
 */
final class CrewModeration
{
    public function __construct(private readonly MediaService $media) {}

    /**
     * @return list<Closure(): void> work for after the commit
     */
    public function remove(Crew $crew): array
    {
        if ($crew->status === CrewStatus::Active) {
            $crew->forceFill(['status_before_removal' => $crew->status->value, 'status' => CrewStatus::Hidden, 'hidden_at' => now()])->save();
        }

        return $this->withdrawPictures($crew);
    }

    /**
     * Logo and cover rejected and their public files withdrawn after the commit (also RemoveCrew). Idempotent.
     *
     * @return list<Closure(): void>
     */
    public function withdrawPictures(Crew $crew): array
    {
        $pictures = $this->pictures($crew);

        foreach ($pictures as $photo) {
            $photo->forceFill(['moderation_status' => ModerationStatus::Rejected])->save();
        }

        return $pictures === [] ? [] : [function () use ($pictures): void {
            foreach ($pictures as $photo) {
                $this->media->withdraw($photo);
            }
        }];
    }

    /**
     * @return array<string, mixed>
     */
    public function snapshot(Crew $crew): array
    {
        return [
            'status' => $crew->status->value,
            'pictures' => array_map(fn (Media $photo): array => ['id' => $photo->id, 'moderation_status' => $photo->moderation_status->value], $this->pictures($crew)),
        ];
    }

    /**
     * @param  array<string, mixed>  $snapshot
     * @return list<Closure(): void>
     */
    public function restore(Crew $crew, array $snapshot): array
    {
        if ($crew->trashed() || $crew->status !== CrewStatus::Hidden) {
            return [];
        }

        $before = CrewStatus::tryFrom(is_string($snapshot['status'] ?? null) ? $snapshot['status'] : '') ?? CrewStatus::Active;
        $crew->forceFill([
            'status' => $before === CrewStatus::Removed ? CrewStatus::Active : $before,
            'status_before_removal' => null,
            'hidden_at' => null,
        ])->save();

        $was = [];
        foreach (is_array($snapshot['pictures'] ?? null) ? $snapshot['pictures'] : [] as $row) {
            if (is_array($row) && is_string($row['id'] ?? null)) {
                $was[$row['id']] = ModerationStatus::tryFrom(is_string($row['moderation_status'] ?? null) ? $row['moderation_status'] : '');
            }
        }

        $pictures = $this->pictures($crew);

        foreach ($pictures as $photo) {
            $status = $was[$photo->id] ?? null;
            $photo->forceFill(['moderation_status' => $status === null || $status === ModerationStatus::Rejected ? ModerationStatus::Approved : $status])->save();
        }

        return $pictures === [] ? [] : [function () use ($pictures): void {
            foreach ($pictures as $photo) {
                $this->media->republish($photo->refresh());
            }
        }];
    }

    /**
     * @return list<Media>
     */
    private function pictures(Crew $crew): array
    {
        $ids = array_values(array_filter([$crew->logo_media_id, $crew->cover_media_id]));

        return $ids === [] ? [] : array_values(Media::query()->whereIn('id', $ids)->where('status', MediaStatus::Ready->value)->get()->all());
    }
}
