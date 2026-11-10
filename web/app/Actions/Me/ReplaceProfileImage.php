<?php

namespace App\Actions\Me;

use App\Actions\Media\DeleteMedia;
use App\Enums\ProfileImageSlot;
use App\Models\Media;
use App\Models\User;
use App\Services\Media\MediaService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Throwable;

class ReplaceProfileImage
{
    public function __construct(
        private readonly MediaService $media,
        private readonly DeleteMedia $delete,
    ) {}

    /**
     * The old image stays until the new one has passed the pipeline, so a rejected file changes nothing. That pipeline is
     * slow and stays outside the lock. Moving the pointer and deleting what it pointed at is one step: at the row lock,
     * a parallel upload sees the winner's image as the old one, so no image stays public without a pointer to it.
     * The public files of the old image go after the commit, through the normal delete path.
     */
    public function handle(User $user, UploadedFile $file, ProfileImageSlot $slot): User
    {
        $new = $this->media->storeFromUpload($file, $user, $user);

        try {
            [$member, $old] = DB::transaction(function () use ($user, $new, $slot): array {
                $member = User::query()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();
                $oldId = $member->getAttribute($slot->value);

                $member->forceFill([$slot->value => $new->getKey()])->save();

                $old = is_string($oldId) ? Media::query()->find($oldId) : null;

                if ($old !== null) {
                    $this->delete->softDelete($old);
                }

                return [$member, $old];
            });
        } catch (Throwable $exception) {
            $this->delete->handle($new);

            throw $exception;
        }

        if ($old !== null) {
            $this->delete->withdraw($old);
        }

        return $member->refresh();
    }
}
