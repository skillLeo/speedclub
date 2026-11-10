<?php

namespace App\Actions\Media;

use App\Enums\KeywordField;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\PublicPages\OgImages;
use App\Services\Rules\ContentScreen;

class UpdateMedia
{
    public function __construct(private readonly OgImages $og, private readonly ContentScreen $screen) {}

    /**
     * A new focal point moves the crop of the OG image, so the vehicle or member it belongs to gets a new one.
     *
     * @param  array<string, mixed>  $attributes  validated alt, focal_x, focal_y and category
     */
    public function handle(Media $media, array $attributes): Media
    {
        $parent = $media->mediable;
        // SEC-P3-15: a caption is public text on the build or profile; blocked and flagged like a description.
        $flags = $this->screen->screen(self::screened($attributes));

        $media->update($attributes);

        if ($parent instanceof Vehicle || $parent instanceof User) {
            $this->screen->flagAfterCommit($flags, $parent);
        }

        if ($media->wasChanged(['focal_x', 'focal_y']) && ($parent instanceof Vehicle || $parent instanceof User)) {
            $this->og->queue($parent);
        }

        return $media;
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, array{0: KeywordField, 1: string|null}>
     */
    public static function screened(array $attributes): array
    {
        return is_string($attributes['alt'] ?? null) ? ['alt' => [KeywordField::PhotoCaption, $attributes['alt']]] : [];
    }
}
