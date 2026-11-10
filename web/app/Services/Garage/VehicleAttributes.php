<?php

namespace App\Services\Garage;

use App\Actions\Catalog\CreateCatalogRequest;
use App\Models\CatalogRequest;
use App\Models\Generation;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * What a draft and an edit have in common. Catalogue or free text per level: choosing one clears the other, a new make drops a
 * model that no longer fits, and every link of make → model → generation must hold together. Free text also files a catalogue
 * request for ADM-14, once per wording and vehicle ("Nicht gefunden?", 02_PRODUCT_SPEC §3.2).
 */
class VehicleAttributes
{
    private const PLAIN = ['nickname', 'description', 'color', 'model_year'];

    public function __construct(private readonly CreateCatalogRequest $requests) {}

    /**
     * Fills the vehicle without saving it. Only the keys present change.
     *
     * @param  array<string, mixed>  $attributes  validated
     *
     * @throws ValidationException
     */
    public function apply(Vehicle $vehicle, array $attributes): void
    {
        $this->applyCatalogue($vehicle, $attributes);
        $vehicle->unsetRelation('make')->unsetRelation('vehicleModel')->unsetRelation('generation');

        $vehicle->fill(array_intersect_key($attributes, array_flip(self::PLAIN)));

        if (array_key_exists('hu_au_due', $attributes)) {
            $vehicle->setAttribute('hu_au_due', is_string($attributes['hu_au_due']) ? $attributes['hu_au_due'].'-01' : null);
        }

        if (array_key_exists('wizard_step', $attributes)) {
            $vehicle->forceFill(['wizard_step' => $attributes['wizard_step']]);
        }

        if (array_key_exists('cover_media_id', $attributes)) {
            $this->applyCover($vehicle, $attributes['cover_media_id']);
        }

        // Only when one of the two is being set: an edit of the colour must not fail on an older entry.
        if (array_key_exists('model_year', $attributes) || array_key_exists('generation_id', $attributes)) {
            $this->assertYearFits($vehicle);
        }

        $vehicle->forceFill(['slug' => $vehicle->canonicalSlug()]);
    }

    /**
     * After saving, so the request can point at the vehicle.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function fileCatalogRequest(User $user, Vehicle $vehicle, array $attributes): void
    {
        $make = $vehicle->getAttribute('make_text');
        $model = $vehicle->getAttribute('model_text');
        $changed = is_string($attributes['make_text'] ?? null) || is_string($attributes['model_text'] ?? null);

        if (! $changed || (! is_string($make) && ! is_string($model))) {
            return;
        }

        $makeName = is_string($make) ? $make : $vehicle->make?->name;

        $known = CatalogRequest::query()
            ->where('vehicle_id', $vehicle->id)
            ->where('make_text', $makeName)
            ->where('model_text', $model)
            ->exists();

        if (! $known && $this->mayFileRequest($user)) {
            $this->requests->handle($user, ['vehicle_id' => $vehicle->id, 'make_text' => $makeName, 'model_text' => is_string($model) ? $model : null]);
        }
    }

    /**
     * The limit of POST catalog/requests also holds here. Over it the vehicle still saves, with its free text; only the entry in
     * the review queue ADM-14 stays out, so the wizard does not fail on it.
     */
    private function mayFileRequest(User $user): bool
    {
        $filed = CatalogRequest::query()
            ->where('user_id', $user->id)
            ->where('created_at', '>', now()->subMinutes(config()->integer('speedclub.rate_limits.catalog_requests.minutes')))
            ->count();

        return $filed < config()->integer('speedclub.rate_limits.catalog_requests.max');
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function applyCatalogue(Vehicle $vehicle, array $attributes): void
    {
        if (array_key_exists('make_text', $attributes) && is_string($attributes['make_text'])) {
            $vehicle->fill(['make_id' => null, 'make_text' => $attributes['make_text'], 'model_id' => null, 'generation_id' => null]);
        } elseif (array_key_exists('make_id', $attributes)) {
            if ($vehicle->getAttribute('make_id') !== $attributes['make_id']) {
                $vehicle->fill(['model_id' => null, 'model_text' => null, 'generation_id' => null]);
            }

            $vehicle->fill(['make_id' => $attributes['make_id'], 'make_text' => null]);
        } elseif (array_key_exists('make_text', $attributes)) {
            $vehicle->fill(['make_text' => null]);
        }

        if (array_key_exists('model_text', $attributes) && is_string($attributes['model_text'])) {
            $vehicle->fill(['model_id' => null, 'model_text' => $attributes['model_text'], 'generation_id' => null]);
        } elseif (array_key_exists('model_id', $attributes)) {
            if ($vehicle->getAttribute('model_id') !== $attributes['model_id']) {
                $vehicle->fill(['generation_id' => null]);
            }

            $vehicle->fill(['model_id' => $attributes['model_id'], 'model_text' => null]);
        } elseif (array_key_exists('model_text', $attributes)) {
            $vehicle->fill(['model_text' => null]);
        }

        if (array_key_exists('generation_id', $attributes)) {
            $vehicle->fill(['generation_id' => $attributes['generation_id']]);
        }

        $this->assertChain($vehicle);
    }

    private function assertChain(Vehicle $vehicle): void
    {
        $modelId = $vehicle->getAttribute('model_id');
        $generationId = $vehicle->getAttribute('generation_id');

        if ($modelId !== null && VehicleModel::query()->whereKey($modelId)->value('make_id') !== $vehicle->getAttribute('make_id')) {
            throw ValidationException::withMessages(['model_id' => [(string) __('garage.model_mismatch')]]);
        }

        if ($generationId !== null && ($modelId === null || Generation::query()->whereKey($generationId)->value('model_id') !== $modelId)) {
            throw ValidationException::withMessages(['generation_id' => [(string) __('garage.generation_mismatch')]]);
        }
    }

    private function assertYearFits(Vehicle $vehicle): void
    {
        $generationId = $vehicle->getAttribute('generation_id');

        if ($vehicle->model_year === null || $generationId === null) {
            return;
        }

        $generation = Generation::query()->whereKey($generationId)->first();
        $from = $generation?->getAttribute('year_from');
        $to = $generation?->getAttribute('year_to') ?? Carbon::now(config()->string('speedclub.display_timezone'))->year + 1;

        if (is_int($from) && ($vehicle->model_year < $from || $vehicle->model_year > $to)) {
            throw ValidationException::withMessages(['model_year' => [(string) __('garage.year_outside_generation', ['from' => $from, 'to' => $to])]]);
        }
    }

    /**
     * The cover has to be something the page can show: finished and not rejected. Null falls back to the first such photo.
     */
    private function applyCover(Vehicle $vehicle, mixed $mediaId): void
    {
        if ($mediaId === null) {
            $vehicle->forceFill(['cover_media_id' => $vehicle->media()->usablePhoto()->orderBy('sort')->orderBy('id')->value('id')]);

            return;
        }

        $media = Media::query()->whereKey($mediaId)->first();
        $belongs = $media !== null
            && $media->getAttribute('mediable_type') === $vehicle->getMorphClass()
            && $media->getAttribute('mediable_id') === $vehicle->getKey()
            && $media->isUsablePhoto();

        if (! $belongs) {
            throw ValidationException::withMessages(['cover_media_id' => [(string) __('garage.cover_invalid')]]);
        }

        $vehicle->forceFill(['cover_media_id' => $mediaId]);
    }
}
