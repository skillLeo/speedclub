<?php

namespace App\Enums;

/**
 * `next` of a finished passwordless sign-in (09 §8.1): the screen the app opens next. terms = AUTH-09b, username = AUTH-08,
 * profile = AUTH-09, done = Home.
 */
enum SignInNext: string
{
    case Terms = 'terms';
    case Username = 'username';
    case Profile = 'profile';
    case Done = 'done';

    public static function fromStep(?OnboardingStep $step): self
    {
        return match ($step) {
            OnboardingStep::AcceptTerms => self::Terms,
            OnboardingStep::ChooseUsername => self::Username,
            OnboardingStep::ProfileSetup => self::Profile,
            // An e-mail code proves the address, so verify_email is never open after it; any other answer is done.
            default => self::Done,
        };
    }
}
