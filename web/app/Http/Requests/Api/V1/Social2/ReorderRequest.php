<?php

namespace App\Http\Requests\Api\V1\Social2;

use Illuminate\Foundation\Http\FormRequest;

/**
 * PUT me/collections/order (ids of collections) and PUT me/collections/{id}/items/order (items as "type:id"), first = top. Must name
 * every entry exactly once; the controller checks that against what is stored.
 */
class ReorderRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'ids' => ['present', 'array', 'max:'.config()->integer('speedclub.social_2.max_collection_items')],
            'ids.*' => ['string', 'distinct', 'max:60'],
        ];
    }
}
