<?php

namespace App\Services\Maintenance;

use App\Models\MaintenanceLog;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Support\Facades\URL;

/**
 * Photos of service log entries (09 §8.8, maintenance is private): stored on the private disk like chat photos (ChatMedia), never on a
 * public URL. The owner gets signed URLs of GET maintenance-media/{media}/{width}?viewer={id}, valid for media_url_minutes rounded up to
 * the next step; the route checks on every fetch that the viewer still owns the vehicle of the entry.
 */
final class MaintenanceMedia
{
    public static function disk(): string
    {
        return config()->string('speedclub.media.private_disk');
    }

    /**
     * @return list<array{width: int, height: int, url: string}>
     */
    public function variants(Media $media, User $viewer): array
    {
        /** @var array<int|string, string> $paths */
        $paths = $media->getAttribute('variants') ?? [];
        $width = (int) $media->getAttribute('width');
        $height = (int) $media->getAttribute('height');
        $step = max(1, config()->integer('speedclub.messaging.media_url_minutes')) * 60;
        $expires = now()->setTimestamp((intdiv(now()->getTimestamp(), $step) + 2) * $step);
        $variants = [];

        foreach (array_keys($paths) as $variantWidth) {
            $variantWidth = (int) $variantWidth;
            $variants[] = [
                'width' => $variantWidth,
                'height' => $width > 0 ? (int) round($variantWidth * $height / $width) : 0,
                'url' => URL::temporarySignedRoute('api.v1.maintenance-media.show', $expires, ['media' => $media->id, 'width' => $variantWidth, 'viewer' => $viewer->id]),
            ];
        }

        usort($variants, fn (array $a, array $b): int => $a['width'] <=> $b['width']);

        return $variants;
    }

    public function allows(User $viewer, Media $media): bool
    {
        if ($media->trashed() || $viewer->isDeactivated() || ! $media->isUsablePhoto() || $media->getAttribute('mediable_type') !== (new MaintenanceLog)->getMorphClass()) {
            return false;
        }

        $vehicleId = MaintenanceLog::query()->whereKey($media->getAttribute('mediable_id'))->value('vehicle_id');
        $vehicle = is_string($vehicleId) ? Vehicle::query()->find($vehicleId) : null;

        return $vehicle instanceof Vehicle && $vehicle->isOwnedBy($viewer);
    }
}
