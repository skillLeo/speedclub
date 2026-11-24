<?php

namespace App\Http\Controllers\Api\V1\Forum;

use App\Actions\Forum\UploadForumPhoto;
use App\Actions\Media\DeleteMedia;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Forum\StoreForumPhotoRequest;
use App\Http\Resources\V1\MediaResource;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Media;
use App\Models\User;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

/**
 * M5.8 thread photos (10 §7.1: up to 6), on the opening post: re-encoded, EXIF stripped, WebP variants, blurhash, private original.
 */
class ForumPhotoController extends Controller
{
    /**
     * Add a photo to a thread.
     *
     * The author only. Accepts an Idempotency-Key header. A seventh photo: 422 on `file`. Plate blur as for every upload.
     */
    public function store(StoreForumPhotoRequest $request, ForumThread $thread, UploadForumPhoto $upload): MediaResource
    {
        Gate::authorize('update', $thread);
        Gate::authorize('create', Media::class);

        /** @var User $user */
        $user = $request->user();
        /** @var UploadedFile $file */
        $file = $request->file('file');
        /** @var array{alt?: string|null} $attributes */
        $attributes = $request->safe()->only(['alt']);

        /** @status 201 */
        return new MediaResource($upload->handle($user, $thread, $file, $attributes, $request->plateBlur()));
    }

    /**
     * Remove a photo from a thread.
     *
     * The author only, also under a restriction. Answers 204.
     */
    public function destroy(ForumThread $thread, string $media, DeleteMedia $delete): Response
    {
        Gate::authorize('delete', $thread);

        $opening = ForumPost::query()->where('thread_id', $thread->id)->where('is_opening', true)->value('id');
        $photo = Media::query()->whereKey(strtolower($media))->where('mediable_type', (new ForumPost)->getMorphClass())->where('mediable_id', $opening)->first();

        if (! $photo instanceof Media) {
            throw new ApiException(ErrorCode::NotFound);
        }

        Gate::authorize('delete', $photo);
        $delete->handle($photo);

        return response()->noContent();
    }
}
