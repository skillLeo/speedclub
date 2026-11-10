<?php

namespace App\Actions\Admin\Moderation;

use App\Enums\KeywordList;
use App\Models\KeywordRule;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Rules\KeywordRules;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-23 "Begriff hinzufügen" (`moderation.rules`, recent password, reason): a term on the block or the flag list. One rule per
 * normal form across both lists; a term that normalises to nothing is refused. Audited `moderation.keyword_added`; the cached lists
 * are flushed after the commit, so the next member write sees the rule.
 *
 * @throws AuthorizationException|ValidationException
 */
class AddKeywordRule
{
    public function __construct(private readonly KeywordRules $rules) {}

    public function handle(Staff $staff, string $term, KeywordList $list, string $reason): KeywordRule
    {
        StaffAtoms::ensure($staff, 'moderation.rules');
        $term = trim((string) preg_replace('/\s+/u', ' ', $term));
        $normalized = KeywordNormaliser::term($term);

        if ($normalized === '' || mb_strlen($normalized) < 2) {
            throw ValidationException::withMessages(['term' => [(string) __('validation.min.string', ['attribute' => 'term', 'min' => 2])]]);
        }

        $existing = KeywordRule::query()->where('normalized', $normalized)->first();

        if ($existing instanceof KeywordRule) {
            throw ValidationException::withMessages(['term' => [(string) __('validation.unique', ['attribute' => $existing->term])]]);
        }

        $rule = DB::transaction(function () use ($staff, $term, $normalized, $list, $reason): KeywordRule {
            $rule = new KeywordRule;
            $rule->forceFill(['term' => $term, 'normalized' => $normalized, 'list' => $list, 'created_by' => $staff->id])->save();

            Audit::record('moderation.keyword_added', $rule, null, ['term' => $term, 'list' => $list->value], trim($reason), $staff);

            return $rule;
        });

        DB::afterCommit(fn () => $this->rules->flush());

        return $rule;
    }
}
