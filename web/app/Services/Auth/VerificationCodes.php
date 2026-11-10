<?php

namespace App\Services\Auth;

use App\Enums\VerificationPurpose;
use App\Models\User;
use App\Models\VerificationCode;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Six-digit codes by e-mail (02_PRODUCT_SPEC §3.1). At rest only a keyed hash: six digits under a plain hash would fall
 * to a lookup table if the table ever leaked.
 *
 * The guess budget per account and purpose is bounded three times: attempts per code, codes per hour, codes per rolling
 * 24 hours (ADR-134). None of it touches the password: spending the codes never stops a member from signing in.
 */
final class VerificationCodes
{
    /**
     * A new code replaces the open one. Returns null while the cooldown, the hourly or the daily limit holds: the caller
     * stays neutral and simply sends nothing.
     *
     * $proved: the caller just proved the password, as at a forced password change. Such codes have a budget of their own,
     * since anybody who only knows the address can use up the common one (ADR-140).
     *
     * $email: the address the code is for when it is not the account's, i.e. the new address of an e-mail change (SET-03).
     */
    public function issue(User $user, VerificationPurpose $purpose, bool $proved = false, ?string $email = null): ?string
    {
        return DB::transaction(function () use ($user, $purpose, $proved, $email): ?string {
            User::query()->whereKey($user->getKey())->lockForUpdate()->value('id');

            if (! $this->mayIssue($user, $purpose, $proved)) {
                return null;
            }

            // Close the open codes by primary key. A ranged UPDATE that matches nothing (a new member) takes a gap lock up to
            // the end of the index, and two sign-ups at the same moment then deadlock on their INSERTs. The member row lock
            // above already serialises issue and consume for this member, so a plain read is enough here.
            $openIds = $this->open($user, $purpose)->pluck('id')->all();

            if ($openIds !== []) {
                VerificationCode::query()->whereKey($openIds)->update(['consumed_at' => now()]);
            }

            $code = $this->generate();

            $row = new VerificationCode([
                'user_id' => $user->getKey(),
                'email' => $email,
                'purpose' => $purpose,
                'code_hash' => $this->hash($user, $purpose, $code),
                'expires_at' => now()->addMinutes(config()->integer('speedclub.verification.expires_minutes')),
            ]);
            $row->forceFill(['proved' => $proved])->save();

            return $code;
        });
    }

    /**
     * Codes of this purpose in the last 24 hours, whoever asked for them.
     */
    public function issuedToday(User $user, VerificationPurpose $purpose): int
    {
        return VerificationCode::query()
            ->where('user_id', $user->getKey())
            ->where('purpose', $purpose)
            ->where('created_at', '>', now()->subDay())
            ->count();
    }

    /**
     * True once per code. A wrong code costs an attempt, and the row lock makes parallel guesses count one by one. The
     * member row is locked first, in the same order as issue(). $then runs inside the transaction: if it throws, the code
     * stays unused and the attempt is not counted.
     *
     * Unknown members do the same hash work, so the answer takes the same time. $then gets the code's row (its `email` for SET-03).
     *
     * @param  Closure(VerificationCode): void  $then
     */
    public function consume(?User $user, VerificationPurpose $purpose, string $code, Closure $then): bool
    {
        if ($user === null) {
            hash_equals(hash_hmac('sha256', $code, config()->string('app.key')), str_repeat('0', 64));

            return false;
        }

        return DB::transaction(function () use ($user, $purpose, $code, $then): bool {
            User::query()->whereKey($user->getKey())->lockForUpdate()->value('id');

            $row = $this->open($user, $purpose)->latest('created_at')->latest('id')->lockForUpdate()->first();
            $expected = $this->hash($user, $purpose, $code);

            if ($row === null || $row->attempts >= config()->integer('speedclub.verification.max_attempts')) {
                return false;
            }

            if (! hash_equals((string) $row->code_hash, $expected)) {
                $row->increment('attempts');

                return false;
            }

            $row->forceFill(['consumed_at' => now()])->save();
            $then($row);

            return true;
        });
    }

    public function hasOpen(User $user, VerificationPurpose $purpose): bool
    {
        return $this->open($user, $purpose)->exists();
    }

    /**
     * The newest open code of this purpose, if any: the pending address of an e-mail change.
     */
    public function pending(User $user, VerificationPurpose $purpose): ?VerificationCode
    {
        return $this->open($user, $purpose)->latest('created_at')->latest('id')->first();
    }

    /**
     * Ends the open codes of this purpose without counting an attempt, e.g. an e-mail change whose address turned out to be taken.
     */
    public function close(User $user, VerificationPurpose $purpose): void
    {
        $ids = $this->open($user, $purpose)->pluck('id')->all();

        if ($ids !== []) {
            VerificationCode::query()->whereKey($ids)->update(['consumed_at' => now()]);
        }
    }

    private function mayIssue(User $user, VerificationPurpose $purpose, bool $proved): bool
    {
        $codes = VerificationCode::query()->where('user_id', $user->getKey())->where('purpose', $purpose);
        $cooldown = now()->subSeconds(config()->integer('speedclub.verification.resend_cooldown_seconds'));

        if ((clone $codes)->where('created_at', '>', $cooldown)->exists()) {
            return false;
        }

        $counted = $proved ? (clone $codes)->where('proved', true) : $codes;
        $perDay = config()->integer($proved ? 'speedclub.verification.max_proved_codes_per_day' : 'speedclub.verification.max_codes_per_day');

        return (clone $counted)->where('created_at', '>', now()->subHour())->count() < config()->integer('speedclub.verification.max_codes_per_hour')
            && (clone $counted)->where('created_at', '>', now()->subDay())->count() < $perDay;
    }

    /**
     * @return Builder<VerificationCode>
     */
    private function open(User $user, VerificationPurpose $purpose)
    {
        return VerificationCode::query()
            ->where('user_id', $user->getKey())
            ->where('purpose', $purpose)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now());
    }

    private function generate(): string
    {
        $length = config()->integer('speedclub.verification.code_length');

        return str_pad((string) random_int(0, (10 ** $length) - 1), $length, '0', STR_PAD_LEFT);
    }

    private function hash(User $user, VerificationPurpose $purpose, string $code): string
    {
        return hash_hmac('sha256', $purpose->value.'|'.$user->getKey().'|'.$code, config()->string('app.key'));
    }
}
