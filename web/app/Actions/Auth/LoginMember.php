<?php

namespace App\Actions\Auth;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Auth\LoginThrottle;
use App\Services\Auth\PasswordProof;
use App\Support\Auth\AuthResult;
use App\Support\Auth\DeviceInfo;
use App\Support\Auth\TwoFactorPending;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class LoginMember
{
    public function __construct(
        private readonly LoginThrottle $throttle,
        private readonly PasswordProof $passwords,
        private readonly SignInMember $signIn,
    ) {}

    /**
     * Unknown address and wrong password are the same answer after the same work. Everything about the account's state
     * comes only after a correct password. The delay counts on the account where there is one, whatever was typed.
     */
    public function handle(string $email, string $password, ?DeviceInfo $device, Request $request): AuthResult|TwoFactorPending
    {
        $user = User::query()->where('email', $email)->first();
        $subject = $user === null ? $email : LoginThrottle::accountSubject($user);

        $this->throttle->ensureAllowed($subject);

        if (! $this->passwords->check($user, $password)) {
            $this->throttle->recordFailure($subject);

            throw new ApiException(ErrorCode::InvalidCredentials);
        }

        /** @var User $user */
        // A closed account counts the attempt like a wrong password, so its answer cannot be told apart (proposed ADR, M2.5).
        if ($user->isPendingDeletion()) {
            $this->throttle->recordFailure($subject);

            throw new ApiException(ErrorCode::InvalidCredentials);
        }

        $this->throttle->clear($subject);

        SignInMember::ensureMayEnter($user);

        if (config()->boolean('hashing.rehash_on_login') && Hash::needsRehash($user->getAuthPassword())) {
            $user->forceFill(['password' => Hash::make($password)])->save();
        }

        return $this->signIn->begin($user, $device, $request);
    }
}
