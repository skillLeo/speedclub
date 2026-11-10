<?php

namespace App\Actions\Messaging;

use App\Enums\ConversationFolder;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\ConversationParticipant;
use App\Models\User;
use App\Services\Messaging\MessagingSignals;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * [SIG sig.msg_organize] PATCH conversations/{id}: mute until a moment or with no end, pin (at most max_pinned), archive. Requests are
 * answered or deleted, not organised.
 */
class OrganiseConversation
{
    public const INDEFINITE = 'indefinite';

    public function __construct(private readonly MessagingSignals $signals) {}

    /**
     * @param  array{mute?: string|null, pinned?: bool, archived?: bool}  $changes  mute: null unmutes, 'indefinite' mutes with no
     *                                                                              end, an ISO moment mutes until then
     * @param  string|null  $field  the request key a refusal names (OrganiseConversationRequest::sentField)
     */
    public function handle(User $member, ConversationParticipant $me, array $changes, ?string $field = null): ConversationParticipant
    {
        if ($me->folder !== ConversationFolder::Chats) {
            // Named by the key the client sent; without one, `mute` stands for `muted`.
            $field ??= array_key_first($changes) === 'mute' ? 'muted' : (string) array_key_first($changes);

            throw new ApiException(ErrorCode::ValidationFailed, errors: [$field => [(string) __('validation.prohibited', ['attribute' => $field])]]);
        }

        DB::transaction(function () use ($member, $me, $changes): void {
            // The member's row first: two pins at once cannot both pass the limit.
            User::query()->whereKey($member->id)->lockForUpdate()->value('id');
            $locked = ConversationParticipant::query()->whereKey($me->id)->lockForUpdate()->firstOrFail();
            $update = ['updated_at' => now()];

            if (array_key_exists('mute', $changes)) {
                $mute = $changes['mute'];
                $update['muted_indefinitely'] = $mute === self::INDEFINITE;
                $update['muted_until'] = $mute === null || $mute === self::INDEFINITE ? null : CarbonImmutable::parse($mute)->utc();
            }

            if (array_key_exists('pinned', $changes)) {
                $max = config()->integer('speedclub.messaging.max_pinned');

                if ($changes['pinned'] && $locked->pinned_at === null
                    && ConversationParticipant::query()->where('user_id', $member->id)->whereNull('deleted_at')->whereNotNull('pinned_at')->count() >= $max) {
                    throw new ApiException(ErrorCode::ValidationFailed, errors: ['pinned' => [(string) __('messaging.pin_limit', ['max' => $max])]]);
                }

                $update['pinned_at'] = $changes['pinned'] ? ($locked->pinned_at ?? now()) : null;
            }

            if (array_key_exists('archived', $changes)) {
                $update['archived_at'] = $changes['archived'] ? ($locked->archived_at ?? now()) : null;
            }

            ConversationParticipant::query()->whereKey($locked->id)->toBase()->update($update);
        });

        $this->signals->unreadChanged($me->conversation_id, $member->id);

        return $me->refresh();
    }
}
