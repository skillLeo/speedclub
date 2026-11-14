<?php

namespace App\Http\Controllers\Admin\Editorial\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-58 show or hide all sample content here ⚿ (`flags.manage`, reason): the editorial_samples flag of this environment. */
class SampleFlagRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'flags.manage';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['enabled' => ['required', 'boolean']];
    }
}
