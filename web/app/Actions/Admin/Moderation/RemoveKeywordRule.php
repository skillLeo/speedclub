<?php

namespace App\Actions\Admin\Moderation;

use App\Models\KeywordRule;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Rules\KeywordRules;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-23 "Entfernen" (`moderation.rules`, recent password, reason): the rule and its hit counts go; audited `moderation.keyword_removed`
 * with the term and list it had.
 *
 * @throws AuthorizationException
 */
class RemoveKeywordRule
{
    public function __construct(private readonly KeywordRules $rules) {}

    public function handle(Staff $staff, KeywordRule $rule, string $reason): void
    {
        StaffAtoms::ensure($staff, 'moderation.rules');

        DB::transaction(function () use ($staff, $rule, $reason): void {
            $before = ['term' => $rule->term, 'list' => $rule->list->value];
            Audit::record('moderation.keyword_removed', $rule, $before, null, trim($reason), $staff);
            $rule->delete();
        });

        DB::afterCommit(fn () => $this->rules->flush());
    }
}
