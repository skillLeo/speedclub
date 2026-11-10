<?php

namespace App\Actions\Admin\Account;

use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Team\StaffCodes;
use App\Services\Team\TeamRefused;
use BaconQrCode\Renderer\Color\Rgb;
use BaconQrCode\Renderer\Image\SvgImageBackEnd;
use BaconQrCode\Renderer\ImageRenderer;
use BaconQrCode\Renderer\RendererStyle\Fill;
use BaconQrCode\Renderer\RendererStyle\RendererStyle;
use BaconQrCode\Writer;
use Illuminate\Contracts\Session\Session;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Contracts\TwoFactorAuthenticationProvider;
use PragmaRX\Google2FA\Google2FA;

/**
 * ADM-51 "Authenticator wechseln", step 1 (SEC-P1-39): a current code of the confirmed key, then a new 160-bit key is kept pending
 * (encrypted, bound to this session, speedclub.team.rotation_minutes). The confirmed key keeps working, for sign-in too, until
 * ConfirmTotpRotation sees a code of the new one. The key and its QR code are returned once, to this answer only (the controller sends it
 * no-store); a lost answer means starting again. Starting again replaces the pending key.
 *
 * @throws TeamRefused no_two_factor, code_invalid, too_many_codes
 */
class StartTotpRotation
{
    public const SECRET_LENGTH = 32;

    public function __construct(
        private readonly StaffCodes $codes,
        private readonly TwoFactorAuthenticationProvider $provider,
        private readonly Google2FA $totp,
    ) {}

    /**
     * @return array{secret: string, otpauth_url: string, qr_svg: string, expires_at: string}
     */
    public function handle(Staff $staff, string $code, Session $session): array
    {
        $this->codes->ensure($staff, $code);

        $secret = $this->totp->generateSecretKey(self::SECRET_LENGTH);
        $url = $this->provider->qrCodeUrl(config()->string('app.name'), $staff->email, $secret);
        $expires = now()->addMinutes(config()->integer('speedclub.team.rotation_minutes'));

        DB::transaction(function () use ($staff, $secret, $session): void {
            $staff->forceFill([
                'two_factor_pending_secret' => $secret,
                'two_factor_pending_session' => self::sessionHash($session),
                'two_factor_pending_at' => now(),
            ])->save();

            Audit::record(StaffSecurityEvent::TwoFactorRotationStarted->value, $staff, actor: $staff);
        });

        return ['secret' => $secret, 'otpauth_url' => $url, 'qr_svg' => self::qr($url), 'expires_at' => $expires->toIso8601String()];
    }

    public static function sessionHash(Session $session): string
    {
        return hash_hmac('sha256', 'totp-rotation|'.$session->getId(), config()->string('app.key'));
    }

    private static function qr(string $url): string
    {
        $svg = (new Writer(new ImageRenderer(
            new RendererStyle(192, 0, null, null, Fill::uniformColor(new Rgb(255, 255, 255), new Rgb(0, 0, 0))),
            new SvgImageBackEnd,
        )))->writeString($url);

        return trim(substr($svg, (int) strpos($svg, "\n") + 1));
    }
}
