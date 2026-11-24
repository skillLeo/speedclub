<?php

namespace App\Http\Controllers\Admin\Forum\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/**
 * Pin, unpin, lock, unlock (reason optional), move (category_id, reason), merge (into_thread_id, reason), solution (post_id or null,
 * reason): moderation.decide.
 */
class ForumThreadToolRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.decide';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $action = (string) str((string) $this->route()?->getName())->afterLast('.');

        // ADR-540: the reason is internal (audit only), so it is optional for every tool.
        return [
            'reason' => ['nullable', 'string', 'max:1000'],
            'category_id' => [$action === 'move' ? 'required' : 'prohibited', 'integer', 'exists:forum_categories,id'],
            'into_thread_id' => [$action === 'merge' ? 'required' : 'prohibited', 'string', 'size:26'],
            'post_id' => [$action === 'solution' ? 'present' : 'prohibited', 'nullable', 'string', 'size:26'],
        ];
    }

    public function optionalReason(): ?string
    {
        $reason = trim($this->string('reason')->value());

        return $reason === '' ? null : $reason;
    }
}
