<?php

namespace App\Http\Requests\Concerns;

/**
 * An `ids` list of at most $max ULIDs, for the reorder endpoints. The size comes first and stops the rest ($stopOnFirstFailure in the
 * request): `distinct` grows with the square of the list, and validation runs ahead of the policy. The wildcard rules are left out of
 * a list that is too long already, because the validator expands them for every element while it is being built, before any rule
 * runs: that time buys nothing but the answer the size rule gives anyway. LimitJsonBody stops a list at about 18,000 ids.
 */
trait ValidatesBoundedIdList
{
    /**
     * @return array<string, list<string>>
     */
    protected function boundedIdRules(int $max): array
    {
        $rules = ['ids' => ['required', 'array', 'min:1', 'max:'.$max]];
        $ids = $this->input('ids');

        if (! is_array($ids) || count($ids) <= $max) {
            $rules['ids.*'] = ['required', 'string', 'ulid', 'distinct'];
        }

        return $rules;
    }
}
