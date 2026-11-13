<?php

namespace App\Http\Controllers\Api\V1\Maintenance;

use App\Actions\Maintenance\UploadMaintenancePhoto;
use App\Actions\Media\DeleteMedia;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Maintenance\MaintenanceMediaRequest;
use App\Http\Requests\Api\V1\Maintenance\MaintenancePhotoRequest;
use App\Http\Resources\V1\MaintenancePhotoResource;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Maintenance\MaintenanceMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Photos of service log entries (receipts, booklet stamps): private disk, signed URLs, owner only (09 §8.8).
 */
class MaintenancePhotoController extends Controller
{
    use FindsMaintenance;

    /**
     * Add a photo to a service log entry.
     *
     * Multipart `file` (JPEG, PNG or WebP, re-encoded, EXIF/GPS stripped). At most 6 per entry (409 limit_reached). Accepts an
     * Idempotency-Key header, so an outbox upload that resumes adds nothing twice.
     */
    public function store(MaintenancePhotoRequest $request, Vehicle $vehicle, string $log, UploadMaintenancePhoto $action): JsonResponse
    {
        $owner = $this->owner($request, $vehicle);
        /** @var UploadedFile $file */
        $file = $request->file('file');

        /** @status 201 */
        return (new MaintenancePhotoResource($action->handle($owner, $this->log($vehicle, $log), $file)))->response()->setStatusCode(201);
    }

    /**
     * Delete a photo of a service log entry.
     *
     * Answers 204.
     */
    public function destroy(Request $request, Vehicle $vehicle, string $log, string $media, DeleteMedia $delete): Response
    {
        $this->owner($request, $vehicle);
        $entry = $this->log($vehicle, $log);
        $photo = Media::query()->whereKey(strtolower($media))->where('mediable_type', $entry->getMorphClass())->where('mediable_id', $entry->id)->first();

        if (! $photo instanceof Media) {
            throw new ApiException(ErrorCode::NotFound);
        }

        $delete->handle($photo);

        return response()->noContent();
    }

    /**
     * Fetch a service log photo.
     *
     * Only by the signed URL of a `MaintenanceLogResource.photos` entry; 403 for an expired or altered signature, 404 when the viewer no
     * longer owns the vehicle.
     *
     * @unauthenticated
     */
    public function show(MaintenanceMediaRequest $request, string $media, int $width, MaintenanceMedia $maintenanceMedia): StreamedResponse
    {
        $photo = Media::query()->whereKey(strtolower($media))->first();
        $viewer = User::query()->find($request->viewerId());
        /** @var array<int|string, string> $variants */
        $variants = $photo?->getAttribute('variants') ?? [];
        $path = $variants[(string) $width] ?? $variants[$width] ?? null;

        if (! $photo instanceof Media || ! $viewer instanceof User || ! is_string($path) || ! $maintenanceMedia->allows($viewer, $photo)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return Storage::disk(MaintenanceMedia::disk())->response($path, null, [
            'Content-Type' => 'image/webp',
            'Cache-Control' => 'private, max-age=600',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
