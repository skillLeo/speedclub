<?php

namespace App\Enums;

/**
 * M5.7 (10 §6.1, m5.7-contract §1): what a counted view is about, a public member profile or a public vehicle page.
 */
enum ViewSubject: string
{
    case Profile = 'profile';
    case Vehicle = 'vehicle';
}
