<?php

namespace App\Services\Rules;

use App\Enums\ErrorCode;
use App\Enums\KeywordField;
use App\Enums\KeywordList;
use App\Exceptions\ApiException;
use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\Event;
use App\Models\Message;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Support\Facades\DB;

/**
 * The one hook the member write paths call (m3.4-contract §1, ADM-23): before the write, screen() refuses a text that holds a term of
 * the block list with 422 `content_blocked` and a neutral message on the field (never naming the term, so the list cannot be probed
 * word by word); after it, flagAfterCommit() files an automated report about the written content when a term of the flag list matched,
 * once the write committed. Message bodies are flag only. Staff writes (EditMemberProfile) never pass through here.
 *
 * Hook points: CreateVehicleDraft / UpdateVehicle (description), AddBuildNote (note), UpdateProfile (bio, display_name), SendMessage and
 * StartConversation (body).
 */
class ContentScreen
{
    public function __construct(
        private readonly KeywordRules $rules,
        private readonly KeywordFlagger $flagger,
    ) {}

    /**
     * @param  array<string, array{0: KeywordField, 1: string|null}>  $fields  request field => [kind, text]
     * @return list<array{field: KeywordField, rules: list<array{id: int, term: string, list: string}>}> the flag matches, for flagAfterCommit()
     *
     * @throws ApiException 422 content_blocked
     */
    public function screen(array $fields): array
    {
        $blocked = [];
        $flags = [];

        foreach ($fields as $name => [$kind, $text]) {
            if ($kind->mayBlock()) {
                $hits = $this->rules->match($text, KeywordList::Block);

                if ($hits !== []) {
                    $this->rules->count($hits, $kind);
                    $blocked[$name] = [(string) __('errors.content_blocked_field')];

                    continue;
                }
            }

            $hits = $this->rules->match($text, KeywordList::Flag);

            if ($hits !== []) {
                $flags[] = ['field' => $kind, 'rules' => $hits];
            }
        }

        if ($blocked !== []) {
            throw new ApiException(ErrorCode::ContentBlocked, errors: $blocked);
        }

        return $flags;
    }

    /**
     * After the outermost commit: counts the flag hits and files one automated report about $target (a case for a person to review).
     *
     * @param  list<array{field: KeywordField, rules: list<array{id: int, term: string, list: string}>}>  $flags
     */
    public function flagAfterCommit(array $flags, User|Vehicle|BuildUpdate|Message|Comment|Event $target): void
    {
        if ($flags === []) {
            return;
        }

        DB::afterCommit(function () use ($flags, $target): void {
            foreach ($flags as $flag) {
                $this->rules->count($flag['rules'], $flag['field']);
            }

            $this->flagger->flag($target, $flags);
        });
    }
}
