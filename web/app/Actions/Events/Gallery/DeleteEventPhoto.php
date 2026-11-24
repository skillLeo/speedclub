<?php

namespace App\Actions\Events\Gallery;

use App\Actions\Media\DeleteMedia;
use App\Models\EventPhoto;
use App\Models\Media;
use Illuminate\Support\Facades\DB;

/**
 * M5.6: the uploader takes their photo back, or the organiser takes any photo of their event down. The row is soft-deleted and its
 * picture goes through DeleteMedia (public files at once, the private original with the 30-day hard delete, which also removes the row).
 */
class DeleteEventPhoto
{
    public function __construct(private readonly DeleteMedia $media) {}

    public function handle(EventPhoto $photo): void
    {
        $media = Media::query()->find($photo->media_id);

        DB::transaction(function () use ($photo, $media): void {
            $photo->delete();

            if ($media instanceof Media) {
                $this->media->softDelete($media);
            }
        });

        if ($media instanceof Media) {
            $this->media->withdraw($media);
        }
    }
}
