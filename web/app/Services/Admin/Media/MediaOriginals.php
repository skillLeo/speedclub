<?php

namespace App\Services\Admin\Media;

use App\Enums\ModerationStatus;
use App\Http\Controllers\Admin\Media\MediaReviewController;
use App\Models\Media;
use App\Models\Staff;
use App\Services\Audit\Audit;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;

/**
 * DQ-532: the private original of a photo a decision removed (ADR-123 keeps only it, for a reversal). A reveal is a sensitive view,
 * audited `media.original_viewed` like a PII reveal, and answers a signed URL valid MINUTES; only that URL serves the bytes. Never a
 * chat photo (message content), never the path.
 */
final class MediaOriginals
{
    public const EVENT = 'media.original_viewed';

    public const MINUTES = 5;

    /**
     * @return array{url: string, expires_in: int}
     */
    public function reveal(Staff $staff, Media $media): array
    {
        $this->pathOf($media);

        DB::transaction(fn () => Audit::record(self::EVENT, $media, after: ['tab' => 'hidden'], actor: $staff));

        return [
            'url' => URL::temporarySignedRoute('admin.media.original.file', now()->addMinutes(self::MINUTES), ['media' => $media->id], absolute: false),
            'expires_in' => self::MINUTES * 60,
        ];
    }

    /** The bytes of the original; aborts 404 like pathOf(). */
    public function bytes(Media $media): string
    {
        $bytes = $this->disk()->get($this->pathOf($media));
        abort_if($bytes === null, 404);

        return $bytes;
    }

    /** The original of a removed, non-chat photo; 404 for any other photo, and when the file is gone. */
    public function pathOf(Media $media): string
    {
        $path = $media->getAttribute('original_path');
        $removed = $media->moderation_status === ModerationStatus::Rejected && ! $media->trashed();
        abort_unless($removed && is_string($path) && $path !== '' && ! in_array($media->getAttribute('mediable_type'), MediaReviewController::PRIVATE_TYPES, true), 404);
        abort_unless($this->disk()->exists($path), 404);

        return $path;
    }

    private function disk(): Filesystem
    {
        return Storage::disk(config()->string('speedclub.media.private_disk'));
    }
}
