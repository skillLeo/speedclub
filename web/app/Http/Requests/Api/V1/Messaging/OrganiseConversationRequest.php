<?php

namespace App\Http\Requests\Api\V1\Messaging;

use App\Actions\Messaging\OrganiseConversation;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * [SIG sig.msg_organize] `PATCH conversations/{id}`: mute (until a moment, or with no end), pin, archive. At least one key.
 *
 * Mute: `{muted: true}` (or `{muted: true, muted_until: null}`) mutes with no end, "Bis du es wieder änderst"; `{muted_until: iso}`
 * (with or without `muted: true`) mutes until then; `{muted: false}` or `{muted_until: null}` unmutes.
 */
class OrganiseConversationRequest extends FormRequest
{
    private const KEYS = ['muted', 'muted_until', 'pinned', 'archived'];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** True mutes: with no end unless muted_until names one. False unmutes and takes no muted_until. */
            'muted' => ['sometimes', 'boolean:strict'],
            /** Muted until this moment (ISO 8601), at most a year ahead. Null without `muted: true` unmutes. */
            'muted_until' => ['nullable', 'date', 'after:now', 'before:+1 year +1 day', 'prohibited_if_declined:muted'],
            'pinned' => ['sometimes', 'boolean:strict'],
            'archived' => ['sometimes', 'boolean:strict'],
        ];
    }

    /**
     * @return list<Closure(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if (array_intersect_key($this->all(), array_flip(self::KEYS)) === []) {
                $validator->errors()->add('muted_until', (string) __('validation.required_without_all', ['attribute' => 'muted_until', 'values' => 'muted, pinned, archived']));
            }
        }];
    }

    /**
     * The first organise key the client sent, in the order muted, muted_until, pinned, archived: a refusal names it (code review M2.8
     * nit 10), so `{muted_until: …}` alone is refused under muted_until, not under muted.
     */
    public function sentField(): string
    {
        foreach (self::KEYS as $key) {
            if ($this->exists($key)) {
                return $key;
            }
        }

        return self::KEYS[0];
    }

    /**
     * The changes in the action's terms: `mute` is absent (unchanged), null (off), 'indefinite', or the ISO moment it ends.
     *
     * @return array{mute?: string|null, pinned?: bool, archived?: bool}
     */
    public function changes(): array
    {
        /** @var array{muted?: bool, muted_until?: string|null, pinned?: bool, archived?: bool} $given */
        $given = $this->safe()->only(array_keys(array_intersect_key($this->all(), array_flip(self::KEYS))));
        $changes = array_intersect_key($given, array_flip(['pinned', 'archived']));
        $until = $given['muted_until'] ?? null;

        if (($given['muted'] ?? null) === false) {
            $changes['mute'] = null;
        } elseif (($given['muted'] ?? null) === true) {
            $changes['mute'] = $until ?? OrganiseConversation::INDEFINITE;
        } elseif (array_key_exists('muted_until', $given)) {
            $changes['mute'] = $until;
        }

        return $changes;
    }
}
