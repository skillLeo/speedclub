<?php

namespace App\Actions\Social\Updates;

use App\Enums\BuildUpdateKind;
use App\Enums\ErrorCode;
use App\Enums\MediaStatus;
use App\Exceptions\ApiException;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\User;
use App\Services\Media\MediaService;
use App\Services\Media\PlateBlurChoice;
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
    public function handle(User $user, BuildUpdate $update, UploadedFile $file, array $attributes, ?PlateBlurChoice $plateBlur = null): Media
    {
        $bytes = $this->media->inspectUpload($file);

        $reserved = DB::transaction(function () use ($user, $update, $attributes, $bytes, $plateBlur): Media {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            $locked = BuildUpdate::query()->whereKey($update->getKey())->lockForUpdate()->firstOrFail();
            $beforeAfter = $locked->kind === BuildUpdateKind::BeforeAfter;
            $limit = $beforeAfter ? config()->integer('speedclub.build_score.before_after_photos') : config()->integer('speedclub.social_2.update_max_photos');

            if ($locked->photos()->where('status', '!=', MediaStatus::Failed)->count() >= $limit) {
                $message = $beforeAfter ? __('build_score.before_after.photo_limit') : __('social.updates.photo_limit_reached', ['max' => $limit]);

                throw new ApiException(ErrorCode::ValidationFailed, errors: ['file' => [(string) $message]]);
            }

            $sort = $locked->photos()->max('sort');
            $media = $this->media->reserve($user, $locked, [...$attributes, 'sort' => is_numeric($sort) ? (int) $sort + 1 : 0], strlen($bytes), plateBlur: $plateBlur);

            // M5.9c (m5.9c contract §2, ADR-436 d): the post exists first, its photos follow. The second photo of a before/after
            // completes the pair in upload order (before, after) unless the owner paired them already; PATCH photo_pairs can still swap.
            if ($beforeAfter && ($locked->photo_pairs ?? []) === []) {
                $photos = $locked->photos()->where('status', '!=', MediaStatus::Failed)->pluck('id')->map(strval(...))->all();

                if (count($photos) === 2) {
                    $locked->forceFill(['photo_pairs' => [[$photos[0], $photos[1]]]])->save();
                }
            }

            return $media;
        });

        return $this->media->processOrQueue($reserved, $bytes);
    }
}
