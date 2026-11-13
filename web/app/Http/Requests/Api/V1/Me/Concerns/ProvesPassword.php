<?php

namespace App\Http\Requests\Api\V1\Me\Concerns;

use App\Models\User;
use App\Services\Auth\RecentAuthentication;
use Illuminate\Validation\Rule;

/**
 * The password re-check of the M2.5 security endpoints. M4.6 (09 §8.1): within 10 minutes of a sign-in or POST me/reauth it may be left
 * out, which is the only way through for a passwordless account; a password that is sent is still checked.
 */
trait ProvesPassword
{
    /**
     * @return list<mixed>
     */
    protected function passwordRule(): array
    {
        return [
            Rule::requiredIf(fn (): bool => ! $this->recentlyAuthenticated()),
            'nullable',
            'string',
            'max:'.config()->integer('speedclub.passwords.max_length'),
        ];
    }

    private function recentlyAuthenticated(): bool
    {
        $user = $this->user();

        return $user instanceof User && app(RecentAuthentication::class)->isRecent($user, $this);
    }
}
