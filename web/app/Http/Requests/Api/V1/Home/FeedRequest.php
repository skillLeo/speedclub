<?php

namespace App\Http\Requests\Api\V1\Home;

use App\Enums\ErrorCode;
use App\Enums\FeedTab;
use App\Exceptions\ApiException;
use App\Rules\ValidCursor;
use App\Rules\ValidStreamCursor;
use App\Services\Home\StreamCursor;
use App\Services\Home\StreamState;
use App\Support\Viewer;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * GET feed?tab=for_you|following. "Folge ich" needs a member: a guest hears 401 and a deactivated account 403 before anything else is
 * checked.
 */
class FeedRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        if ($this->query('tab') !== FeedTab::Following->value) {
            return;
        }

        $viewer = Viewer::from($this);

        if ($viewer === null) {
            throw new ApiException(ErrorCode::Unauthenticated);
        }

        // A deactivated account follows nobody any more (UserPolicy::update).
        if ($viewer->isDeactivated()) {
            throw new ApiException(ErrorCode::Forbidden);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'tab' => ['required', 'string', Rule::enum(FeedTab::class)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.home.feed_max_page_size')],
            'cursor' => ['nullable', 'string', 'max:2000', $this->cursorRule()],
        ];
    }

    public function tab(): FeedTab
    {
        return FeedTab::from((string) $this->validated('tab'));
    }

    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.home.feed_page_size');
    }

    /**
     * The decoded Für dich cursor; null on the first page.
     */
    public function streamState(): ?StreamState
    {
        $cursor = $this->validated('cursor');

        return is_string($cursor) && $cursor !== '' ? StreamCursor::decode($cursor) : null;
    }

    /**
     * Each tab has its own cursor: a signed stream state for Für dich, a list cursor over (at, id) for Folge ich. One of the other tab,
     * forged or cut, is the same 422 as on every list.
     */
    private function cursorRule(): ValidCursor|ValidStreamCursor
    {
        return $this->query('tab') === FeedTab::Following->value ? new ValidCursor(['at', 'id']) : new ValidStreamCursor;
    }
}
