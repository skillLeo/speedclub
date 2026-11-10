<?php

namespace App\Services\Auth;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PragmaRX\Google2FA\Google2FA;
use Throwable;

/**
 * Member TOTP (SET-05, AUTH-11; 05_ARCHITECTURE §8: pragmarx/google2fa). Keys are 32 base32 characters, 160 bits, the length RFC 4226
 * §4 recommends (the staff default of 80 bits is SEC-P1-38). A code counts once: the accepted time step is stored and only a later one
 * passes (RFC 6238 §5.2). Recovery codes are stored as HMAC-SHA256 hashes (keyed with APP_KEY) inside the encrypted column: a dump
 * without APP_KEY yields nothing, and even with it every code still needs a search of 2^50; a spent one is removed.
 *
 * Never log a secret, a code or a recovery code.
 */
final class TwoFactor
{
    public const SECRET_LENGTH = 32;

    public const RECOVERY_CODES = 10;

    /** Without 0/O, 1/I/L: a code read off paper is typed right. */
    private const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    public function __construct(private readonly Google2FA $totp) {}

    public function newSecret(): string
    {
        return $this->totp->generateSecretKey(self::SECRET_LENGTH);
    }

    public function otpauthUrl(User $user, string $secret): string
    {
        $holder = $user->username ?? $user->email;

        return $this->totp->getQRCodeUrl(config()->string('app.name'), $holder, $secret);
    }

    /**
     * A current code for this secret, newer than the last accepted one. Takes the member's row lock, so two requests with the same code
     * cannot both pass.
     */
    public function verifyCode(User $user, string $code, ?string $secret = null): bool
    {
        if (preg_match('/\A\d{6}\z/', $code) !== 1) {
            return false;
        }

        return DB::transaction(function () use ($user, $code, $secret): bool {
            $fresh = User::query()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();
            $secret ??= $fresh->getAttribute('two_factor_secret');

            if (! is_string($secret) || $secret === '') {
                return false;
            }

            $last = $fresh->getAttribute('two_factor_last_step');

            try {
                // Step 0 instead of null: the library then answers the step that matched, not just true.
                $step = $this->totp->verifyKeyNewer($secret, $code, is_int($last) ? $last : 0, 1);
            } catch (Throwable) {
                return false;
            }

            if (! is_int($step)) {
                return false;
            }

            $fresh->forceFill(['two_factor_last_step' => $step])->save();
            $user->setAttribute('two_factor_last_step', $step);

            return true;
        });
    }

    /**
     * Ten new codes, "ABCDE-FGHJK" (50 bits each). Returns them for the one answer that shows them; only their hashes are stored.
     *
     * @return array{plain: list<string>, hashes: list<string>}
     */
    public function newRecoveryCodes(): array
    {
        $plain = [];

        for ($i = 0; $i < self::RECOVERY_CODES; $i++) {
            $plain[] = $this->randomChunk().'-'.$this->randomChunk();
        }

        return ['plain' => $plain, 'hashes' => array_map($this->hashRecoveryCode(...), $plain)];
    }

    /**
     * Spends a recovery code: true once, then it is gone. Under the member's row lock.
     */
    public function useRecoveryCode(User $user, string $code): bool
    {
        $hash = $this->hashRecoveryCode($code);

        return DB::transaction(function () use ($user, $hash): bool {
            $fresh = User::query()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();
            /** @var list<string>|null $stored */
            $stored = $fresh->getAttribute('two_factor_recovery_codes');
            $left = [];
            $found = false;

            foreach ($stored ?? [] as $candidate) {
                if (! $found && hash_equals($candidate, $hash)) {
                    $found = true;

                    continue;
                }

                $left[] = $candidate;
            }

            if ($found) {
                $fresh->forceFill(['two_factor_recovery_codes' => $left])->save();
                $user->setAttribute('two_factor_recovery_codes', $left);
            }

            return $found;
        });
    }

    /**
     * A six-digit TOTP code or a recovery code, whichever it looks like.
     */
    public function verifyEither(User $user, string $code): bool
    {
        $code = trim($code);

        return preg_match('/\A\d{6}\z/', $code) === 1 ? $this->verifyCode($user, $code) : $this->useRecoveryCode($user, $code);
    }

    public function remainingRecoveryCodes(User $user): int
    {
        $stored = $user->getAttribute('two_factor_recovery_codes');

        return is_array($stored) ? count($stored) : 0;
    }

    private function hashRecoveryCode(string $code): string
    {
        $normal = strtoupper(str_replace([' ', '-'], '', trim($code)));

        return hash_hmac('sha256', 'recovery|'.$normal, config()->string('app.key'));
    }

    private function randomChunk(): string
    {
        $chunk = '';
        $max = strlen(self::RECOVERY_ALPHABET) - 1;

        for ($i = 0; $i < 5; $i++) {
            $chunk .= self::RECOVERY_ALPHABET[random_int(0, $max)];
        }

        return Str::upper($chunk);
    }
}
