<?php

namespace App\Actions\Maintenance;

use App\Enums\ErrorCode;
use App\Enums\MediaCategory;
use App\Exceptions\ApiException;
use App\Models\MaintenanceLog;
use App\Models\Media;
use App\Models\User;
use App\Services\Maintenance\MaintenanceMedia;
use App\Services\Media\MediaService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * A photo of a service log entry (receipt, the stamp in the booklet; 09 §8.8): through MediaService like every upload (re-encoded,
 * EXIF/GPS stripped, WebP variants, blurhash, quota), but on the private disk, read through signed URLs by the owner only. At most
 * MaintenanceLog::MAX_PHOTOS per entry.
 */
class UploadMaintenancePhoto
{
    public function __construct(private readonly MediaService $media) {}

    public function handle(User $owner, MaintenanceLog $log, UploadedFile $file): Media
    {
        $bytes = $this->media->inspectUpload($file);

        $reserved = DB::transaction(function () use ($owner, $log, $bytes): Media {
            // The member's row first, as every upload: the quota check then sees parallel uploads.
            User::query()->whereKey($owner->id)->lockForUpdate()->value('id');
            /** @var MaintenanceLog $locked */
            $locked = MaintenanceLog::query()->whereKey($log->id)->lockForUpdate()->firstOrFail();

            if ($locked->media()->count() >= MaintenanceLog::MAX_PHOTOS) {
                throw new ApiException(ErrorCode::LimitReached);
            }

            return $this->media->reserve($owner, $locked, ['category' => MediaCategory::Other, 'sort' => $locked->media()->count()], strlen($bytes), MaintenanceMedia::disk());
        });

        return $this->media->processOrQueue($reserved, $bytes);
    }
}
