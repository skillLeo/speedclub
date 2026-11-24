<?php

namespace App\Actions\Crews;

use App\Models\Crew;
use App\Models\Media;
use App\Models\User;
use App\Services\Media\MediaService;
use App\Services\Media\PlateBlurChoice;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Logo (square) and cover (16:9) of a crew (contract-crews.md §3 #10, #11). Through MediaService like every upload: re-encoded, EXIF/GPS
 * stripped, WebP variants, blurhash, private original. A new one replaces the old, whose files go; removing one deletes its files.
 */
class CrewMediaSlot
{
    public function __construct(private readonly MediaService $media) {}

    /**
     * @param  'logo'|'cover'  $slot
     * @param  array{alt?: string|null, focal_x?: float|null, focal_y?: float|null}  $attributes
     */
    public function upload(User $user, Crew $crew, string $slot, UploadedFile $file, array $attributes, ?PlateBlurChoice $plateBlur = null): Media
    {
        CrewFields::assertActive($crew);
        $bytes = $this->media->inspectUpload($file);
        $column = self::column($slot);

        [$reserved, $previous] = DB::transaction(function () use ($user, $crew, $attributes, $bytes, $column, $plateBlur): array {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            $locked = Crew::withTrashed()->whereKey($crew->id)->lockForUpdate()->firstOrFail();
            CrewFields::assertActive($locked);
            $previous = $locked->getAttribute($column);
            $media = $this->media->reserve($user, $locked, $attributes, strlen($bytes), plateBlur: $plateBlur);
            $locked->forceFill([$column => $media->id])->save();

            return [$media, is_string($previous) ? $previous : null];
        });

        $processed = $this->media->processOrQueue($reserved, $bytes);
        $this->purge($previous);

        return $processed;
    }

    /**
     * @param  'logo'|'cover'  $slot
     */
    public function remove(Crew $crew, string $slot): void
    {
        $column = self::column($slot);

        $previous = DB::transaction(function () use ($crew, $column): ?string {
            /** @var Crew $locked */
            $locked = Crew::query()->whereKey($crew->id)->lockForUpdate()->firstOrFail();
            $previous = $locked->getAttribute($column);
            $locked->forceFill([$column => null])->save();

            return is_string($previous) ? $previous : null;
        });

        $this->purge($previous);
    }

    private function purge(?string $id): void
    {
        if ($id !== null && ($old = Media::withTrashed()->find($id)) instanceof Media) {
            $this->media->purge($old);
        }
    }

    /**
     * @param  'logo'|'cover'  $slot
     */
    private static function column(string $slot): string
    {
        return $slot === 'logo' ? 'logo_media_id' : 'cover_media_id';
    }
}
