<?php

namespace App\Actions\Social\Updates;

use App\Enums\ErrorCode;
use App\Enums\MediaStatus;
use App\Exceptions\ApiException;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\User;
use App\Services\Media\MediaService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * A photo of a posted update (UPD-01, 09 §8.5: up to 10). Through MediaService like every upload: re-encoded, EXIF stripped, variants,
 * blurhash, private original. Same order of locks as the other uploads: the member first, then the update; the limit is checked under
 * the lock while reserving, the image work runs after the commit.
 */
class UploadBuildUpdatePhoto
{
    public function __construct(private readonly MediaService $media) {}

    /**
     * @param  array{alt?: string|null, focal_x?: float|null, focal_y?: float|null}  $attributes
     */
    public function handle(User $user, BuildUpdate $update, UploadedFile $file, array $attributes): Media
    {
        $bytes = $this->media->inspectUpload($file);

        $reserved = DB::transaction(function () use ($user, $update, $attributes, $bytes): Media {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            $locked = BuildUpdate::query()->whereKey($update->getKey())->lockForUpdate()->firstOrFail();
            $limit = config()->integer('speedclub.social_2.update_max_photos');

            if ($locked->photos()->where('status', '!=', MediaStatus::Failed)->count() >= $limit) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['file' => [(string) __('social.updates.photo_limit_reached', ['max' => $limit])]]);
            }

            $sort = $locked->photos()->max('sort');

            return $this->media->reserve($user, $locked, [...$attributes, 'sort' => is_numeric($sort) ? (int) $sort + 1 : 0], strlen($bytes));
        });

        return $this->media->processOrQueue($reserved, $bytes);
    }
}
