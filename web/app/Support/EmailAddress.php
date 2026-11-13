<?php

namespace App\Support;

/**
 * The one form a member address is stored and looked up in (05_ARCHITECTURE §6): trimmed, lowercased, and the domain in ASCII.
 *
 * max@müller.de and max@xn--mller-kva.de are the same mailbox. The native app sends what was typed, a browser's type=email
 * input sends punycode, so without this one address became two accounts (recheck round 3). Mail goes to the ASCII form, which
 * every SMTP server takes. The local part is left as it is: an umlaut there is refused at sign-up (DeliverableEmail).
 *
 * Something that is not an address, or a domain IDNA refuses, keeps its lowercased input, so validation answers as it would anyway.
 */
final class EmailAddress
{
    public static function normalize(string $email): string
    {
        $email = trim($email);
        $at = strrpos($email, '@');

        if ($at === false) {
            return mb_strtolower($email);
        }

        $local = substr($email, 0, $at);
        $domain = substr($email, $at + 1);

        return mb_strtolower($local).'@'.mb_strtolower(self::asciiDomain($domain));
    }

    /**
     * Only a domain with non-ASCII characters is converted: an ASCII one is already what IDNA would answer, up to case.
     */
    public static function asciiDomain(string $domain): string
    {
        if ($domain === '' || preg_match('/[^\x00-\x7F]/', $domain) !== 1) {
            return $domain;
        }

        $ascii = idn_to_ascii($domain, IDNA_NONTRANSITIONAL_TO_ASCII, INTL_IDNA_VARIANT_UTS46);

        return is_string($ascii) && $ascii !== '' ? $ascii : $domain;
    }

    /**
     * M4.6 AUTH-13/AUTH-16: "s•••@gmail.com" — the first character of the local part and the domain, for "Gesendet an …".
     */
    public static function mask(string $email): string
    {
        $at = mb_strrpos($email, '@');

        if ($at === false || $at === 0) {
            return '•••';
        }

        return mb_substr($email, 0, 1).'•••'.mb_substr($email, $at);
    }
}
