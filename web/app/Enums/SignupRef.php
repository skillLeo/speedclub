<?php

namespace App\Enums;

/**
 * Where a sign-up began (ADR-216), sent by the client as `ref` on auth/register: a QR sticker scan, a public vehicle page or a public
 * profile. Anything else is no source. Counts only; nothing about the scan or the page is stored.
 */
enum SignupRef: string
{
    case Qr = 'qr';
    case PublicVehicle = 'public_vehicle';
    case PublicProfile = 'public_profile';
}
