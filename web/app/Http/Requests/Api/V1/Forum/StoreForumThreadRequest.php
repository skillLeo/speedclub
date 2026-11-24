<?php

namespace App\Http\Requests\Api\V1\Forum;

use App\Services\Forum\ForumTags;
use Illuminate\Foundation\Http\FormRequest;

/**
 * FOR-04: title (≤ 120), category (slug), text (Markdown subset, ≤ 10 000), up to 5 tags, an optional vehicle, mod or product.
 * Photos follow with POST forum/threads/{thread}/photos.
 */
class StoreForumThreadRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';

        return [
            'title' => [$required, 'string', 'min:5', 'max:'.config()->integer('speedclub.forum.title_max')],
            'category' => [$required, 'string', 'max:80'],
            'body' => [$required, 'string', 'min:10', 'max:'.config()->integer('speedclub.forum.opening_max')],
            'tags' => ['sometimes', 'array', 'max:'.config()->integer('speedclub.forum.max_tags')],
            'tags.*' => ['string', 'max:24', 'regex:'.ForumTags::PATTERN],
            'vehicle_id' => ['sometimes', 'nullable', 'string', 'size:26'],
            'modification_id' => ['sometimes', 'nullable', 'string', 'size:26'],
            'product_id' => ['sometimes', 'nullable', 'string', 'size:26'],
        ];
    }

    /**
     * Lower-case tags before the pattern check (members type "Fahrwerk").
     */
    protected function prepareForValidation(): void
    {
        $tags = $this->input('tags');

        if (is_array($tags)) {
            $this->merge(['tags' => array_map(fn (mixed $tag): mixed => is_string($tag) ? mb_strtolower(trim(ltrim(trim($tag), '#'))) : $tag, $tags)]);
        }
    }

    /**
     * @return list<string>
     */
    public function tags(): array
    {
        /** @var list<string> $tags */
        $tags = array_values(array_filter((array) $this->validated('tags', []), is_string(...)));

        return $tags;
    }
}
