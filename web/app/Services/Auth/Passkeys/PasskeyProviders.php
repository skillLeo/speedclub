<?php

namespace App\Services\Auth\Passkeys;

use Laravel\Passkeys\Support\Aaguids;

/**
 * The provider of a passkey from its AAGUID (09 §8.2), for the rows of the passkey list: a bundled map of the common providers with the
 * names people know in German and English and an icon key the app maps to its own glyph, then the community list that ships with
 * laravel/passkeys (passkeydeveloper/passkey-authenticator-aaguids), then nothing.
 */
final class PasskeyProviders
{
    /**
     * @var array<string, array{icon: string, de: string, en: string}>
     */
    public const KNOWN = [
        'fbfc3007-154e-4ecc-8c0b-6e020557d7bd' => ['icon' => 'apple', 'de' => 'iCloud-Schlüsselbund', 'en' => 'iCloud Keychain'],
        'dd4ec289-e01d-41c9-bb89-70fa845d4bf2' => ['icon' => 'apple', 'de' => 'iCloud-Schlüsselbund (verwaltet)', 'en' => 'iCloud Keychain (managed)'],
        'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4' => ['icon' => 'google', 'de' => 'Google Passwortmanager', 'en' => 'Google Password Manager'],
        'adce0002-35bc-c60a-648b-0b25f1f05503' => ['icon' => 'chrome', 'de' => 'Chrome auf dem Mac', 'en' => 'Chrome on Mac'],
        'bada5566-a7aa-401f-bd96-45619a55120d' => ['icon' => '1password', 'de' => '1Password', 'en' => '1Password'],
        'd548826e-79b4-db40-a3d8-11116f7e8349' => ['icon' => 'bitwarden', 'de' => 'Bitwarden', 'en' => 'Bitwarden'],
        '53414d53-554e-4700-0000-000000000000' => ['icon' => 'samsung', 'de' => 'Samsung Pass', 'en' => 'Samsung Pass'],
        '08987058-cadc-4b81-b6e1-30de50dcbe96' => ['icon' => 'windows', 'de' => 'Windows Hello', 'en' => 'Windows Hello'],
        '9ddd1817-af5a-4672-a2b9-3e3dd95000a9' => ['icon' => 'windows', 'de' => 'Windows Hello', 'en' => 'Windows Hello'],
        '6028b017-b1d4-4c02-b4b3-afcdafc96bb2' => ['icon' => 'windows', 'de' => 'Windows Hello', 'en' => 'Windows Hello'],
        'd3452668-01fd-4c12-926c-83a4204853aa' => ['icon' => 'microsoft', 'de' => 'Microsoft Passwortmanager', 'en' => 'Microsoft Password Manager'],
        '531126d6-e717-415c-9320-3d9aa6981239' => ['icon' => 'dashlane', 'de' => 'Dashlane', 'en' => 'Dashlane'],
        '50726f74-6f6e-5061-7373-50726f746f6e' => ['icon' => 'proton', 'de' => 'Proton Pass', 'en' => 'Proton Pass'],
    ];

    /**
     * @return array{name: string|null, icon: string}
     */
    public static function for(?string $aaguid, ?string $locale = null): array
    {
        if ($aaguid === null || $aaguid === Aaguids::unknown()) {
            return ['name' => null, 'icon' => 'key'];
        }

        $aaguid = strtolower($aaguid);
        $known = self::KNOWN[$aaguid] ?? null;

        if ($known !== null) {
            return ['name' => ($locale ?? app()->getLocale()) === 'en' ? $known['en'] : $known['de'], 'icon' => $known['icon']];
        }

        return ['name' => Aaguids::labelFor($aaguid), 'icon' => 'key'];
    }
}
