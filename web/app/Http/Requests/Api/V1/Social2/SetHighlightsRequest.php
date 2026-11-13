<?php

namespace App\Http\Requests\Api\V1\Social2;

use App\Enums\HighlightItemType;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\Vehicle;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * The whole rail in order: up to 8 build updates (own posts and notes, not hidden) or finished photos of this vehicle and its updates.
 */
class SetHighlightsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'items' => ['present', 'array', 'max:'.config()->integer('speedclub.social_2.max_highlights')],
            'items.*' => ['array:type,id'],
            'items.*.type' => ['required', Rule::enum(HighlightItemType::class)],
            'items.*.id' => ['required', 'string', 'size:26'],
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $vehicle = $this->route('vehicle');

            if (! $vehicle instanceof Vehicle || $validator->errors()->isNotEmpty()) {
                return;
            }

            $seen = [];

            /** @var list<array{type: string, id: string}> $items */
            $items = $this->input('items', []);

            foreach ($items as $index => $item) {
                $id = strtolower($item['id']);
                $key = $item['type'].':'.$id;

                if (isset($seen[$key]) || ! $this->belongs($vehicle, HighlightItemType::from($item['type']), $id)) {
                    $validator->errors()->add("items.$index.id", (string) __('social.highlights.not_own'));
                }

                $seen[$key] = true;
            }
        }];
    }

    private function belongs(Vehicle $vehicle, HighlightItemType $type, string $id): bool
    {
        if ($type === HighlightItemType::BuildUpdate) {
            return BuildUpdate::query()->whereKey($id)->where('vehicle_id', $vehicle->id)->where('hidden', false)->exists();
        }

        $updates = BuildUpdate::query()->select('id')->where('vehicle_id', $vehicle->id);

        return Media::query()->whereKey($id)->usablePhoto()
            ->where(fn ($parent) => $parent
                ->where(fn ($own) => $own->where('mediable_type', $vehicle->getMorphClass())->where('mediable_id', $vehicle->id))
                ->orWhere(fn ($post) => $post->where('mediable_type', (new BuildUpdate)->getMorphClass())->whereIn('mediable_id', $updates)))
            ->exists();
    }
}
