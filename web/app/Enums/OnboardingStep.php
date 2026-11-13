<?php

namespace App\Enums;

/**
 * The first open step of F1, where the app resumes after a restart.
 */
enum OnboardingStep: string
{
    case VerifyEmail = 'verify_email';
    // M4.6 AUTH-09b: a passwordless account accepts AGB, Datenschutz and the age line before anything else.
    case AcceptTerms = 'accept_terms';
    case ChooseUsername = 'choose_username';
    case ProfileSetup = 'profile_setup';
}
