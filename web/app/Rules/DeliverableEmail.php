<?php

namespace App\Rules;

use App\Support\EmailAddress;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Symfony\Component\Mime\Address;
use Throwable;

/**
 * An address the first mail can reach. email:rfc takes jürgen@gmail.com, but no code ever gets there: Symfony Mailer throws unless the
 * mail host offers SMTPUTF8, and a failed mail is only logged. The account would exist with no way to verify it. A domain with an
 * umlaut is fine, as the transport writes it in punycode (max@müller.de goes to xn--mller-kva.de).
 *
 * email:rfc also takes what no relay delivers to (SEC-P1-51): a host without a dot (a@localhost), an IP literal (a@[127.0.0.1]) or a
 * bare IP (a@127.0.0.1), comments (a@(x)x.de, a(b)@x.de) and quoted or spaced local parts ("a b"@x.de). Accepted is what a mail
 * provider hands out: a dot-atom local part in ASCII, and a domain name of at least two DNS labels whose last label has a letter and is
 * no reserved name (a@sub.localhost, a@x.local, a@x.test, a@x.invalid, a@x.example, a@x.internal; "test" stays open on local and testing
 * hosts for the demo and e2e accounts).
 *
 * For sign-up and the e-mail change only: sign-in, forgot and reset answer neutrally for any address, and such an address has no account.
 */
class DeliverableEmail implements ValidationRule
{
    /** RFC 5322 dot-atom with the atext characters: no quotes, no spaces, no parentheses, no leading, trailing or double dot. */
    private const LOCAL_PART = '/^[A-Za-z0-9!#$%&\'*+\/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&\'*+\/=?^_`{|}~-]+)*$/D';

    /** One DNS label: letters, digits and hyphens, 1 to 63 characters, no hyphen at either end. */
    private const LABEL = '/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iD';

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            return;
        }

        if (! self::deliverable($value)) {
            $fail('validation.email')->translate();
        }
    }

    public static function deliverable(string $address): bool
    {
        $at = strrpos($address, '@');

        if ($at === false || $at === 0) {
            return false;
        }

        $local = substr($address, 0, $at);
        $domain = EmailAddress::asciiDomain(substr($address, $at + 1));

        if (strlen($local) > 64 || preg_match(self::LOCAL_PART, $local) !== 1 || ! self::hostName($domain)) {
            return false;
        }

        // The transport's own parser has the last word: what it refuses is never sent.
        try {
            new Address($local.'@'.$domain);
        } catch (Throwable) {
            return false;
        }

        return true;
    }

    private static function hostName(string $domain): bool
    {
        if ($domain === '' || strlen($domain) > 253) {
            return false;
        }

        $labels = explode('.', $domain);

        if (count($labels) < 2) {
            return false;
        }

        foreach ($labels as $label) {
            if (preg_match(self::LABEL, $label) !== 1) {
                return false;
            }
        }

        $top = strtolower(end($labels));

        // A top-level domain is never all digits: that is an IP address written without brackets. Nor a name reserved for local or
        // documentation use (a@sub.localhost, .local, .test, .invalid, .example, .internal; speedclub.verification.reserved_email_tlds).
        return preg_match('/[a-z]/', $top) === 1 && ! in_array($top, config()->array('speedclub.verification.reserved_email_tlds'), true);
    }
}
