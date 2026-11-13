<?php

namespace App\Http\Controllers\Api\V1\Social2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Social2\MentionSuggestRequest;
use App\Http\Resources\V1\MemberSummaryResource;
use App\Models\User;
use App\Services\Social\Mentions;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class MentionController extends Controller
{
    /**
     * Suggest members to mention (UPD-01 autocomplete).
     *
     * Members you follow or who follow you, and members you mentioned before, whose username or name starts with `q` (a leading @ is
     * ignored) and whose "Wer darf mich erwähnen" lets you mention them. At most 8, by username. Never across a block; no sample members
     * while samples are hidden.
     */
    public function __invoke(MentionSuggestRequest $request, Mentions $mentions): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        return MemberSummaryResource::collection($mentions->suggest($user, (string) $request->input('q', ''), config()->integer('speedclub.social_2.mention_suggest_limit')));
    }
}
