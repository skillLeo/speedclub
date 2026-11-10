<?php

namespace Database\Factories;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Models\Media;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Model;

/**
 * Default is an unattached, finished upload. Attach it with forModel().
 *
 * @extends Factory<Media>
 */
class MediaFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $hash = fake()->unique()->sha256();
        $variants = [];

        foreach ([320, 640, 1080, 1600] as $width) {
            $variants[(string) $width] = "media/$hash/$width.webp";
        }

        return [
            'owner_id' => User::factory(),
            'disk' => 'public',
            'original_path' => "originals/$hash.jpg",
            'variants' => $variants,
            'width' => 1600,
            'height' => 1067,
            'blurhash' => 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
            'status' => MediaStatus::Ready,
            'moderation_status' => ModerationStatus::Approved,
        ];
    }

    public function forModel(Model $model): static
    {
        return $this->state(fn (array $attributes) => [
            'mediable_type' => $model->getMorphClass(),
            'mediable_id' => $model->getKey(),
        ]);
    }
}
