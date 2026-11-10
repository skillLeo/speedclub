<?php

namespace App\Http\Requests\Api\V1\Signature;

use App\Models\Vehicle;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class CompareRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $slug = ['required', 'string', 'max:200', 'regex:/^[A-Za-z0-9-]+$/'];

        return [
            /** The first build: its slug from `/v/{slug}` ("nissan-skyline-gt-r-r34-8k2m4q"); only the public id at the end counts. */
            'a' => $slug,
            /** The second build, another one than `a`. */
            'b' => $slug,
        ];
    }

    /**
     * The same build twice compares nothing.
     *
     * @return list<Closure(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $a = Vehicle::findBySlug($this->string('a')->toString());
            $b = Vehicle::findBySlug($this->string('b')->toString());

            if ($a !== null && $b !== null && $a->is($b)) {
                $validator->errors()->add('b', (string) __('signature.compare.same_build'));
            }
        }];
    }
}
