<?php

namespace App\Http\Controllers\Admin\Content\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/**
 * An ADM-29…33 write: one permission atom (also on the route and in the Action). Subclasses name the atom and the shape the page sends;
 * the Actions validate the content itself.
 */
abstract class ContentRequest extends FormRequest
{
    abstract protected function atom(): string;

    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can($this->atom());
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }

    public function reason(): string
    {
        return trim($this->string('reason')->value());
    }
}
