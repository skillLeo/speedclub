<?php

namespace App\Http\Controllers\Admin\SavedViews\Requests;

use App\Actions\Admin\Overview\SavedViews;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class StoreSavedViewRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user('staff') instanceof Staff;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // The DataTable's `id`. Any module's table, without a shared list: a view only stores a query for its own owner.
            'table' => ['required', 'string', 'max:60', 'regex:/^[a-z][a-z0-9_-]*$/'],
            'name' => ['required', 'string', 'min:2', 'max:80'],
            'query' => ['required', 'array:filter,sort,per_page,columns'],
            'query.filter' => ['sometimes', 'array', 'max:12'],
            'query.filter.*' => ['nullable', 'string', 'max:200'],
            'query.sort' => ['sometimes', 'nullable', 'string', 'max:60', 'regex:/^-?[a-z_]+$/'],
            'query.per_page' => ['sometimes', 'integer', 'in:25,50,100'],
            'query.columns' => ['sometimes', 'array', 'max:40'],
            'query.columns.*' => ['string', 'max:60', 'regex:/^[a-z_]+$/'],
        ];
    }

    /**
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            /** @var Staff $staff */
            $staff = $this->user('staff');
            $table = $this->string('table')->value();

            if (SavedViews::count($staff, $table) >= SavedViews::MAX_PER_TABLE && ! $this->replacesOwnView($staff, $table)) {
                $validator->errors()->add('name', __('validation.max.array', ['attribute' => 'views', 'max' => SavedViews::MAX_PER_TABLE]));
            }
        }];
    }

    private function replacesOwnView(Staff $staff, string $table): bool
    {
        return collect(SavedViews::for($staff, $table))->contains('name', $this->string('name')->value());
    }
}
