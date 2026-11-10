<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Me\ReplaceProfileImage;
use App\Enums\ProfileImageSlot;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Me\UploadProfileImageRequest;
use App\Http\Resources\V1\MeResource;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

class ProfileImageController extends Controller
{
    /**
     * Replace the avatar.
     *
     * Multipart. Accepts an Idempotency-Key header. Up to 15 MB, JPEG, PNG or WebP by content (413, 415). The old image
     * is deleted.
     */
    public function avatar(UploadProfileImageRequest $request, ReplaceProfileImage $action): MeResource
    {
        return $this->replace($request, $action, ProfileImageSlot::Avatar);
    }

    /**
     * Replace the cover image.
     *
     * Multipart. Accepts an Idempotency-Key header. Up to 15 MB, JPEG, PNG or WebP by content (413, 415). The old image
     * is deleted.
     */
    public function cover(UploadProfileImageRequest $request, ReplaceProfileImage $action): MeResource
    {
        return $this->replace($request, $action, ProfileImageSlot::Cover);
    }

    private function replace(UploadProfileImageRequest $request, ReplaceProfileImage $action, ProfileImageSlot $slot): MeResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('updateProfile', $user);

        /** @var UploadedFile $file */
        $file = $request->file('file');

        return new MeResource($action->handle($user, $file, $slot));
    }
}
