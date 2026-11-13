<?php

namespace App\Actions\Businesses;

use App\Models\Business;
use App\Models\Media;
use App\Models\User;
use App\Services\Media\MediaService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Logo or cover of a business (BIZ-01: logo 56, cover 16:9). Through MediaService like every upload: re-encoded, EXIF/GPS stripped,
 * WebP variants, blurhash, private original. A new one replaces the old, whose files go.
 */
class UploadBusinessMedia
{
    public function __construct(private readonly MediaService $media) {}

    /**
     * @param  'logo'|'cover'  $slot
     * @param  array{alt?: string|null, focal_x?: float|null, focal_y?: float|null}  $attributes
     */
    public function handle(User $user, Business $business, string $slot, UploadedFile $file, array $attributes): Media
    {
        $bytes = $this->media->inspectUpload($file);
        $column = $slot === 'logo' ? 'logo_media_id' : 'cover_media_id';

        [$reserved, $previous] = DB::transaction(function () use ($user, $business, $attributes, $bytes, $column): array {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            /** @var Business $locked */
            $locked = Business::query()->whereKey($business->id)->lockForUpdate()->firstOrFail();
            $previous = $locked->getAttribute($column);
            $media = $this->media->reserve($user, $locked, $attributes, strlen($bytes));
            $locked->forceFill([$column => $media->id])->save();

            return [$media, is_string($previous) ? $previous : null];
        });

        $processed = $this->media->processOrQueue($reserved, $bytes);

        if ($previous !== null && ($old = Media::withTrashed()->find($previous)) instanceof Media) {
            $this->media->purge($old);
        }

        return $processed;
    }
}
