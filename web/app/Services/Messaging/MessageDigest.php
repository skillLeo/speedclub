<?php

namespace App\Services\Messaging;

use App\Enums\ConversationFolder;
use App\Enums\UserStatus;
use App\Mail\MessageDigestMail;
use App\Models\ConversationParticipant;
use App\Models\User;
use App\Services\Notifications\NotificationPrefs;
use App\Services\Notifications\NotificationTexts;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/**
 * The daily e-mail digest (m2.4-contract §4): one mail to a member who turned `new_message.email_digest` on, when a chat holds a message
 * of the other side that has stayed unread for more than digest_after_hours, counted per conversation. A conversation is told about
 * once per new message: digested_message_id remembers the last message a mail covered. Muted, archived, deleted, blocked chats and
 * requests are left out. The mail is queued and holds a count only.
 */
class MessageDigest
{
    public function __construct(
        private readonly Conversations $conversations,
        private readonly NotificationTexts $texts,
    ) {}

    /**
     * @return int mails queued
     */
    public function run(int $maxSeconds = 40): int
    {
        $started = microtime(true);
        $after = '';
        $sent = 0;

        do {
            $users = $this->candidates()->where('p.user_id', '>', $after)->distinct()->orderBy('p.user_id')->limit(config()->integer('speedclub.messaging.digest_chunk'))->pluck('p.user_id');

            foreach ($users as $userId) {
                $after = (string) $userId;
                $sent += $this->digest((string) $userId);
            }
        } while ($users->isNotEmpty() && microtime(true) - $started < $maxSeconds);

        return $sent;
    }

    private function digest(string $userId): int
    {
        $user = User::query()->find($userId);

        if (! $user instanceof User || ! $user->isActive() || ! $user->hasVerifiedEmail() || ! (NotificationPrefs::for($user)['types']['new_message']['email_digest'] ?? false)) {
            return 0;
        }

        $rows = $this->candidates()->where('p.user_id', $user->id)->select(['p.id', 'c.last_message_id'])->get();

        if ($rows->isEmpty()) {
            return 0;
        }

        Mail::to($user->email)->locale($this->texts->locale($user))->queue(new MessageDigestMail($rows->count()));

        foreach ($rows as $row) {
            /** @var object{id: int, last_message_id: string} $row */
            ConversationParticipant::query()->whereKey($row->id)->toBase()->update(['digested_message_id' => $row->last_message_id]);
        }

        return 1;
    }

    /**
     * Participant rows (as p, with the conversation as c) whose chat holds a message of the other side that is older than the window,
     * unread, visible to the member and newer than what the last mail covered.
     */
    private function candidates(): Builder
    {
        $before = now()->subHours(config()->integer('speedclub.messaging.digest_after_hours'));

        return DB::table('conversation_participants as p')
            ->join('conversations as c', 'c.id', '=', 'p.conversation_id')
            ->join('users as u', 'u.id', '=', 'p.user_id')
            ->leftJoin('conversation_participants as o', fn ($join) => $join->on('o.conversation_id', '=', 'p.conversation_id')->whereColumn('o.user_id', '!=', 'p.user_id'))
            ->where('p.folder', ConversationFolder::Chats->value)
            ->whereNull('p.deleted_at')
            ->whereNull('p.archived_at')
            ->where('p.unread_count', '>', 0)
            ->where('p.muted_indefinitely', false)
            ->where(fn (Builder $mute) => $mute->whereNull('p.muted_until')->orWhere('p.muted_until', '<=', now()))
            ->where('u.status', UserStatus::Active->value)
            ->whereNull('u.deleted_at')
            ->where(fn (Builder $told) => $told->whereNull('p.digested_message_id')->orWhereColumn('c.last_message_id', '>', 'p.digested_message_id'))
            ->whereNotExists(fn (Builder $blocks) => $blocks->selectRaw('1')->from('blocks')
                ->where(fn (Builder $pair) => $pair->whereColumn('blocks.blocker_id', 'p.user_id')->whereColumn('blocks.blocked_id', 'o.user_id'))
                ->orWhere(fn (Builder $pair) => $pair->whereColumn('blocks.blocker_id', 'o.user_id')->whereColumn('blocks.blocked_id', 'p.user_id')))
            ->whereExists(function (Builder $waiting) use ($before): void {
                $this->conversations->visibleFor($waiting->selectRaw('1')->from('messages as m')->whereColumn('m.conversation_id', 'p.conversation_id'), 'm', 'p')
                    ->where(fn (Builder $other) => $other->whereColumn('m.sender_id', '!=', 'p.user_id')->orWhereNull('m.sender_id'))
                    ->where(fn (Builder $unread) => $unread->whereNull('p.last_read_message_id')->orWhereColumn('m.id', '>', 'p.last_read_message_id'))
                    ->where(fn (Builder $told) => $told->whereNull('p.digested_message_id')->orWhereColumn('m.id', '>', 'p.digested_message_id'))
                    ->where('m.created_at', '<', $before);
            });
    }
}
