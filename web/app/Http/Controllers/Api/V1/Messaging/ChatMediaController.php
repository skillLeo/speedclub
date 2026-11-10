<?php

namespace App\Http\Controllers\Api\V1\Messaging;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Messaging\ChatMediaRequest;
use App\Models\Media;
use App\Models\User;
use App\Services\Messaging\ChatMedia;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Chat photos from the private disk (M2.4 review #5). The signed URL is the credential (an image tag sends no bearer token), and the
 * viewer it names must still see the photo; anything else is the same 404.
 */
class ChatMediaController extends Controller
{
    /**
     * Fetch a chat photo.
     *
     * Only by the signed URL of a `MessageResource.media` or upload answer; 403 for an expired or altered signature, 404 when the viewer
     * no longer sees the photo.
     *
     * @unauthenticated
     */
    public function show(ChatMediaRequest $request, string $media, int $width, ChatMedia $chatMedia): StreamedResponse
    {
        $photo = Media::query()->whereKey(strtolower($media))->first();
        $viewer = User::query()->find($request->viewerId());
        /** @var array<int|string, string> $variants */
        $variants = $photo?->getAttribute('variants') ?? [];
        $path = $variants[(string) $width] ?? $variants[$width] ?? null;

        if (! $photo instanceof Media || ! $viewer instanceof User || ! is_string($path) || ! $chatMedia->allows($viewer, $photo)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return Storage::disk(ChatMedia::disk())->response($path, null, [
            'Content-Type' => 'image/webp',
            'Cache-Control' => 'private, max-age=600',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
