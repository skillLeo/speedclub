<?php

namespace App\Actions\Forum;

use App\Enums\ErrorCode;
use App\Enums\MediaStatus;
use App\Exceptions\ApiException;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Media;
use App\Models\User;
use App\Services\Forum\ForumPremoderation;
use App\Services\Media\MediaService;
use App\Services\Media\PlateBlurChoice;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * A photo of a thread (10 §7.1: up to 6), on its opening post. Through MediaService like every upload: re-encoded (EXIF and GPS gone),
 * WebP variants, blurhash, private original, plate blur as the member chose. The limit is checked under the lock while reserving; the
 * image work runs after the commit.
 *
 * SEC-P5-09: a photo an author still inside the pre-moderation window adds to a published thread sends its opening post back to review
 * (ForumPremoderation): the thread stays listed, its text and photos hidden from others until staff approve it again.
 */
class UploadForumPhoto
{
    public function __construct(
        private readonly MediaService $media,
        private readonly ForumPremoderation $premoderation,
    ) {}

    /**
     * @param  array{alt?: string|null}  $attributes
     */
    public function handle(User $user, ForumThread $thread, UploadedFile $file, array $attributes, ?PlateBlurChoice $plateBlur = null): Media
    {
        $bytes = $this->media->inspectUpload($file);

        $reserved = DB::transaction(function () use ($user, $thread, $attributes, $bytes, $plateBlur): Media {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            /** @var ForumPost $opening */
            $opening = ForumPost::query()->where('thread_id', $thread->id)->where('is_opening', true)->lockForUpdate()->firstOrFail();
            $limit = config()->integer('speedclub.forum.max_photos');

            if ($opening->photos()->where('status', '!=', MediaStatus::Failed)->count() >= $limit) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['file' => [(string) __('forum.photos.limit', ['max' => $limit])]]);
            }

            if ($this->premoderation->holdsChange($user, $opening)) {
                ForumPremoderation::backToReview($opening)->save();
            }

            $sort = $opening->photos()->max('sort');

            return $this->media->reserve($user, $opening, [...$attributes, 'sort' => is_numeric($sort) ? (int) $sort + 1 : 0], strlen($bytes), plateBlur: $plateBlur);
        });

        return $this->media->processOrQueue($reserved, $bytes);
    }
}
