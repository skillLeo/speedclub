<?php

namespace App\Services\Messaging;

use App\Enums\ConversationFolder;
use App\Enums\InboxFolder;
use App\Enums\UserStatus;
use App\Models\Block;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Services\Discover\MemberNameFilter;
use App\Services\Search\SearchTerms;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * Which conversations a member is an active participant of, and what of them the member sees (m2.4-contract §1, §2):
 *
 * - active: the member's participant row exists and is not deleted for the member, and no block exists either way with the other
 *   member. Anything else is the same 404 as an id that never existed, never 403;
 * - visible messages: after the member's clearing point, not hidden by the member, not removed.
 */
class Conversations
{
    private const ULID = '/\A[0-9a-hjkmnp-tv-z]{26}\z/i';

    /**
     * The member's active side of a conversation, with the conversation and the other side loaded; null for a 404.
     */
    public function participantFor(User $member, string $conversationId, bool $lock = false): ?ConversationParticipant
    {
        if (preg_match(self::ULID, $conversationId) !== 1) {
            return null;
        }

        $query = ConversationParticipant::query()
            ->where('conversation_id', strtolower($conversationId))
            ->where('user_id', $member->id)
            ->whereNull('deleted_at');

        if ($lock) {
            $query->lockForUpdate();
        }

        $participant = $query->first();

        if (! $participant instanceof ConversationParticipant) {
            return null;
        }

        $other = $this->otherOf($participant);

        if ($other !== null && $this->blocked($member->id, $other->user_id)) {
            return null;
        }

        return $participant;
    }

    /**
     * A message the member sees, in a conversation the member is an active participant of, with that participant; null for a 404.
     *
     * @return array{0: ConversationParticipant, 1: Message}|null
     */
    public function messageFor(User $member, string $messageId): ?array
    {
        if (preg_match(self::ULID, $messageId) !== 1) {
            return null;
        }

        $conversationId = Message::query()->whereKey(strtolower($messageId))->value('conversation_id');
        $participant = is_string($conversationId) ? $this->participantFor($member, $conversationId) : null;
        $message = $participant === null ? null : $this->visibleMessages($participant)->whereKey(strtolower($messageId))->first();

        return $participant !== null && $message instanceof Message ? [$participant, $message] : null;
    }

    public function otherOf(ConversationParticipant $participant): ?ConversationParticipant
    {
        return ConversationParticipant::query()
            ->where('conversation_id', $participant->conversation_id)
            ->where('user_id', '!=', $participant->user_id)
            ->first();
    }

    public function blocked(string $first, string $second): bool
    {
        return Block::query()
            ->where(fn ($query) => $query->where('blocker_id', $first)->where('blocked_id', $second))
            ->orWhere(fn ($query) => $query->where('blocker_id', $second)->where('blocked_id', $first))
            ->exists();
    }

    /**
     * The inbox of a folder, as rows of the member's participant table with the other side joined (other_user_id, null when the account
     * is gone) and the newest message the member sees (preview_id). Not ordered: Inbox orders and pages it.
     *
     * @param  list<string>  $words  [SIG organise] search words: the other member's name or the text of a visible message
     * @return Builder<ConversationParticipant>
     */
    public function inboxQuery(User $member, InboxFolder $folder, array $words = []): Builder
    {
        $query = ConversationParticipant::query()
            ->from('conversation_participants as p')
            ->leftJoin('conversation_participants as o', function (JoinClause $join): void {
                $join->on('o.conversation_id', '=', 'p.conversation_id')->whereColumn('o.user_id', '!=', 'p.user_id');
            })
            ->where('p.user_id', $member->id)
            ->whereNull('p.deleted_at')
            ->whereNotNull('p.last_message_at')
            ->whereNotExists(fn (QueryBuilder $blocks) => $blocks->selectRaw('1')->from('blocks')
                ->where(fn (QueryBuilder $pair) => $pair->whereColumn('blocks.blocker_id', 'p.user_id')->whereColumn('blocks.blocked_id', 'o.user_id'))
                ->orWhere(fn (QueryBuilder $pair) => $pair->whereColumn('blocks.blocker_id', 'o.user_id')->whereColumn('blocks.blocked_id', 'p.user_id')))
            ->select('p.*')
            ->addSelect(['o.user_id as other_user_id'])
            ->selectSub($this->previewIdQuery(), 'preview_id');

        match ($folder) {
            InboxFolder::Chats => $query->where('p.folder', ConversationFolder::Chats->value)->whereNull('p.archived_at'),
            InboxFolder::Archived => $query->where('p.folder', ConversationFolder::Chats->value)->whereNotNull('p.archived_at'),
            // A request of an account that is gone is no request any more (review #13): out of Anfragen and the badge.
            InboxFolder::Requests => $query->where('p.folder', ConversationFolder::Requests->value)->whereNull('p.accepted_at')
                ->whereExists(fn (QueryBuilder $users) => $users->selectRaw('1')->from('users as ru')->whereColumn('ru.id', 'o.user_id')
                    ->whereNull('ru.deleted_at')->where('ru.status', '!=', UserStatus::Deactivated->value)),
        };

        if ($words !== []) {
            $query->where(function (Builder $match) use ($words): void {
                $match->whereExists(function (QueryBuilder $users) use ($words): void {
                    $users->selectRaw('1')->from('users as u')->whereColumn('u.id', 'o.user_id')->whereNull('u.deleted_at');
                    MemberNameFilter::apply($users, $words);
                })->orWhereExists(function (QueryBuilder $messages) use ($words): void {
                    $this->visibleFor($messages->selectRaw('1')->from('messages as m')->whereColumn('m.conversation_id', 'p.conversation_id'), 'm', 'p');
                    $messages->where('m.type', 'text');

                    foreach ($words as $word) {
                        $escaped = SearchTerms::escapeLike($word);
                        $messages->where(fn (QueryBuilder $text) => $text
                            ->whereRaw("m.body LIKE ? ESCAPE '!'", ["$escaped%"])
                            ->orWhereRaw("m.body LIKE ? ESCAPE '!'", ["% $escaped%"])
                            ->orWhereRaw("m.body LIKE ? ESCAPE '!'", ["%\n$escaped%"]));
                    }
                });
            });
        }

        return $query;
    }

    /**
     * The messages a participant sees, newest last by id.
     *
     * @return Builder<Message>
     */
    public function visibleMessages(ConversationParticipant $participant): Builder
    {
        $query = Message::query()->where('messages.conversation_id', $participant->conversation_id);
        $this->visibleFor($query->getQuery(), 'messages', null, $participant);

        return $query;
    }

    /**
     * The visibility rule on a query that reads messages as $m: not removed, after the clearing point, not hidden by the member. Either
     * against a participant row joined as $alias, or against a loaded participant.
     */
    public function visibleFor(QueryBuilder $query, string $m, ?string $alias, ?ConversationParticipant $participant = null): QueryBuilder
    {
        $query->whereNull("$m.deleted_at");

        if ($alias !== null) {
            $query->where(fn (QueryBuilder $cleared) => $cleared->whereNull("$alias.cleared_before_message_id")->orWhereColumn("$m.id", '>', "$alias.cleared_before_message_id"))
                ->whereNotExists(fn (QueryBuilder $hidden) => $hidden->selectRaw('1')->from('message_hidden as h')->whereColumn('h.message_id', "$m.id")->whereColumn('h.user_id', "$alias.user_id"));

            return $query;
        }

        if ($participant?->cleared_before_message_id !== null) {
            $query->where("$m.id", '>', $participant->cleared_before_message_id);
        }

        $userId = $participant?->user_id;

        return $query->whereNotExists(fn (QueryBuilder $hidden) => $hidden->selectRaw('1')->from('message_hidden as h')->whereColumn('h.message_id', "$m.id")->where('h.user_id', $userId));
    }

    private function previewIdQuery(): QueryBuilder
    {
        $query = DB::table('messages as m')->selectRaw('MAX(m.id)')->whereColumn('m.conversation_id', 'p.conversation_id');

        return $this->visibleFor($query, 'm', 'p');
    }
}
