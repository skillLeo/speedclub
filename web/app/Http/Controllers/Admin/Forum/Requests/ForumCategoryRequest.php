<?php

namespace App\Http\Controllers\Admin\Forum\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Models\ForumCategory;
use Illuminate\Validation\Rule;

/**
 * ADM Forum › Kategorien (moderation.rules): create and edit. Slug a-z, 0-9 and hyphens; names DE + EN; one level of sub-categories.
 */
class ForumCategoryRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.rules';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $category = $this->route('category');
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';

        return [
            'reason' => ['nullable', 'string', 'max:1000'],
            'slug' => [$required, 'string', 'max:80', 'regex:/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/', Rule::unique('forum_categories', 'slug')->ignore($category instanceof ForumCategory ? $category->id : null)],
            'name_de' => [$required, 'string', 'min:2', 'max:80'],
            'name_en' => [$required, 'string', 'min:2', 'max:80'],
            'description_de' => ['sometimes', 'nullable', 'string', 'max:300'],
            'description_en' => ['sometimes', 'nullable', 'string', 'max:300'],
            'icon' => ['sometimes', 'nullable', 'string', 'max:40', 'regex:/\A[A-Za-z]+\z/'],
            'parent_id' => ['sometimes', 'nullable', 'integer'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function optionalReason(): ?string
    {
        $reason = trim($this->string('reason')->value());

        return $reason === '' ? null : $reason;
    }
}
