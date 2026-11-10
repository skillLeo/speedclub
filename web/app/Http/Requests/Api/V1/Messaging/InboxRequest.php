<?php

namespace App\Http\Requests\Api\V1\Messaging;

use App\Enums\InboxFolder;
use App\Rules\ValidCursor;
use App\Services\Messaging\Inbox;
use App\Services\Search\SearchTerms;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * MSG-01: `GET conversations?folder=chats|requests|archived&q=&cursor=`. Pinned first, then the newest message.
 */
class InboxRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'folder' => ['nullable', Rule::enum(InboxFolder::class)],
            /** [SIG sig.msg_organize] The other member's name, or words of a message. */
            'q' => ['nullable', 'string', 'max:'.config()->integer('speedclub.messaging.query_max_length')],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.messaging.inbox_max_page_size')],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(Inbox::CURSOR_COLUMNS)],
        ];
    }

    public function folder(): InboxFolder
    {
        return $this->enum('folder', InboxFolder::class) ?? InboxFolder::Chats;
    }

    /**
     * @return list<string>
     */
    public function words(): array
    {
        $q = $this->validated('q');

        return is_string($q) ? SearchTerms::nameWords($q) : [];
    }

    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.messaging.inbox_page_size');
    }
}
