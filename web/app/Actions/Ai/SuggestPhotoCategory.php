<?php

namespace App\Actions\Ai;

use App\Enums\AiFeature;
use App\Enums\ErrorCode;
use App\Enums\MediaCategory;
use App\Enums\MediaStatus;
use App\Exceptions\ApiException;
use App\Models\Media;
use App\Models\User;
use App\Services\Ai\Agents\PhotoCategoryAgent;
use App\Services\Ai\AiFailed;
use App\Services\Ai\AiGateway;
use Laravel\Ai\Files\Image;

/**
 * POST ai/photos/{media}/category (ai.photo_tagging, opt-in; GAR-07/08 upload): the owner's own photo, as its 640 px variant (never the
 * private original; the variants carry no EXIF since the upload re-encoded them) → one of exterior, interior, engine, wheels, detail.
 * Nothing is saved: the app offers it as "KI-Vorschlag: Innenraum" to accept.
 *
 * @throws AiFailed|ApiException
 */
class SuggestPhotoCategory
{
    public function __construct(private readonly AiGateway $gateway) {}

    /**
     * @return array{category: string, label: string}
     */
    public function handle(User $member, Media $photo): array
    {
        $this->gateway->ensureMayUse(AiFeature::PhotoTagging, $member);

        $variant = is_array($photo->getAttribute('variants')) ? ($photo->getAttribute('variants')['640'] ?? null) : null;

        if ($photo->status !== MediaStatus::Ready || ! is_string($variant)) {
            throw new ApiException(ErrorCode::Conflict, (string) __('ai.photo_not_ready'));
        }

        $answer = $this->gateway->ask(AiFeature::PhotoTagging, new PhotoCategoryAgent, 'Which category is this photo?',
            [Image::fromStorage($variant, (string) $photo->getAttribute('disk'))], member: $member);

        $category = MediaCategory::tryFrom((string) $answer->string('category'));

        if ($category === null || ! in_array($category->value, PhotoCategoryAgent::CATEGORIES, true)) {
            $this->gateway->reject($answer);
        }

        return ['category' => $category->value, 'label' => $category->label()];
    }
}
