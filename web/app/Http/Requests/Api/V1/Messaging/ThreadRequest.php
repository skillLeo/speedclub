<?php

namespace App\Http\Requests\Api\V1\Messaging;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `GET conversations/{id}/messages`: without a parameter the newest page, newest first; `before` pages back (newest first); `after`
 * returns newer messages oldest first, for polling.
 */
class ThreadRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $max = $this->filled('after') ? config()->integer('speedclub.messaging.after_limit') : config()->integer('speedclub.messaging.thread_max_page_size');

        return [
            /** Older than this message id. */
            'before' => ['nullable', 'string', MessagingRules::ULID, 'prohibits:after'],
            /** Newer than this message id (polling). */
            'after' => ['nullable', 'string', MessagingRules::ULID],
            'limit' => ['nullable', 'integer', 'min:1', 'max:'.$max],
        ];
    }

    public function beforeId(): ?string
    {
        $id = $this->validated('before');

        return is_string($id) ? strtolower($id) : null;
    }

    public function afterId(): ?string
    {
        $id = $this->validated('after');

        return is_string($id) ? strtolower($id) : null;
    }

    public function limit(): int
    {
        if ($this->filled('limit')) {
            return $this->integer('limit');
        }

        return $this->afterId() !== null ? config()->integer('speedclub.messaging.after_limit') : config()->integer('speedclub.messaging.thread_page_size');
    }
}
