<?php

namespace App\Http\Requests\Api\V1\Gift;

use Illuminate\Foundation\Http\FormRequest;

class CarOfTheDayStoryRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // The owner's line under the Car of the Day, at most 140 characters; null or empty removes it.
            'story_line' => ['present', 'nullable', 'string', 'max:'.config()->integer('speedclub.car_of_the_day.story_max')],
        ];
    }

    public function storyLine(): ?string
    {
        $line = $this->validated('story_line');

        return is_string($line) ? $line : null;
    }
}
