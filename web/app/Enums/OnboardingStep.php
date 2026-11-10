<?php

namespace App\Enums;

/**
 * The first open step of F1, where the app resumes after a restart.
 */
enum OnboardingStep: string
{
    case VerifyEmail = 'verify_email';
    case ChooseUsername = 'choose_username';
    case ProfileSetup = 'profile_setup';
}
