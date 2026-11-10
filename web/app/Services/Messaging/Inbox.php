<?php

namespace App\Services\Messaging;

use App\Enums\ErrorCode;
use App\Enums\InboxFolder;
use App\Exceptions\ApiException;
use App\Models\ConversationParticipant;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Pagination\Cursor;
use Illuminate\Pagination\Paginator;

/**
 * MSG-01 (m2.4-contract §2): pinned first, then the newest message, then the id; keyset pages over the member's participant rows.
 */
class Inbox
{
    public const CURSOR_COLUMNS = ['inbox_pinned', 'inbox_at', 'conversation_id'];

    private const PINNED = '(p.pinned_at IS NOT NULL)';

    public function __construct(
        private readonly Conversations $conversations,
        private readonly ConversationViews $views,
    ) {}

    /**
     * @param  list<string>  $words
     */
    public function page(User $member, InboxFolder $folder, array $words, int $perPage, ?string $cursor): InboxPage
    {
        $query = $this->conversations->inboxQuery($member, $folder, $words)
            ->selectRaw(self::PINNED.' as inbox_pinned')
            ->selectRaw('p.last_message_at as inbox_at');

        $decoded = $cursor === null ? null : $this->apply($query, $cursor);

        $rows = $query
            ->orderByRaw(self::PINNED.' DESC')
            ->orderByDesc('p.last_message_at')
            ->orderByDesc('p.conversation_id')
            ->limit($perPage + 1)
            ->get();

        return new InboxPage($this->views->build($member, $rows), $perPage, $decoded, [
            'path' => Paginator::resolveCurrentPath(),
            'cursorName' => 'cursor',
            'parameters' => self::CURSOR_COLUMNS,
        ]);
    }

    /**
     * @param  Builder<ConversationParticipant>  $query
     */
    private function apply(Builder $query, string $encoded): Cursor
    {
        $cursor = Cursor::fromEncoded($encoded);
        $pinned = $cursor?->parameter('inbox_pinned');
        $at = $cursor?->parameter('inbox_at');
        $id = $cursor?->parameter('conversation_id');

        if ($cursor === null || ! $cursor->pointsToNextItems() || ! in_array($pinned, [0, 1, '0', '1'], true)
            || ! is_string($at) || preg_match('/\A\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?\z/', $at) !== 1
            || ! is_string($id) || preg_match('/\A[0-9a-hjkmnp-tv-z]{26}\z/', $id) !== 1) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['cursor' => [(string) __('errors.cursor_invalid')]]);
        }

        $pinned = (int) $pinned;

        $query->where(fn (Builder $after) => $after
            ->whereRaw(self::PINNED.' < ?', [$pinned])
            ->orWhere(fn (Builder $same) => $same
                ->whereRaw(self::PINNED.' = ?', [$pinned])
                ->where(fn (Builder $older) => $older
                    ->where('p.last_message_at', '<', $at)
                    ->orWhere(fn (Builder $tie) => $tie->where('p.last_message_at', $at)->where('p.conversation_id', '<', $id)))));

        return $cursor;
    }
}
