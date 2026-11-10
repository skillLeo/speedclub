<?php

namespace App\Http\Controllers\Admin\Config\Requests;

use App\Enums\ConfigKey;
use App\Http\Controllers\Admin\Config\Support\ConfigEditor;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A write on one config key of M3.5 (the route names it in `{key}` or as a default). The atom is the key's own (ConfigKey::editAtom()
 * for drafts, publishAtom() for publish and rollback); the engine checks it again (ConfigVersions).
 */
abstract class ConfigKeyRequest extends FormRequest
{
    abstract protected function atom(ConfigKey $key): string;

    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can($this->atom($this->key()));
    }

    public function key(): ConfigKey
    {
        $value = $this->route('key');
        $key = is_string($value) ? ConfigKey::tryFrom($value) : null;
        abort_if($key === null || ! in_array($key, ConfigEditor::KEYS, true), 404);

        return $key;
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
