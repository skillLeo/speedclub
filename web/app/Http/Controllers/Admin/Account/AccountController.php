<?php

namespace App\Http\Controllers\Admin\Account;

use App\Actions\Admin\Account\PendingRotation;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\Team\StaffSessions;
use BaconQrCode\Renderer\Color\Rgb;
use BaconQrCode\Renderer\Image\SvgImageBackEnd;
use BaconQrCode\Renderer\ImageRenderer;
use BaconQrCode\Renderer\RendererStyle\Fill;
use BaconQrCode\Renderer\RendererStyle\RendererStyle;
use BaconQrCode\Writer;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-51 my staff account (06 §3 Settings, m3.6 §1, ADR-238): name, address and roles; the password change (Fortify, ends every other
 * session); the second factor with its rotation (a current code first, the new key pending until a code of it confirms it) and the
 * recovery codes behind a current code; the own sessions with "Abmelden". Nothing secret comes as a prop: the key, its QR code and the
 * recovery codes reach the page only as the no-store JSON answer of the step that shows them (AccountTwoFactorController).
 */
class AccountController extends Controller
{
    public function __invoke(Request $request, StaffSessions $sessions): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $rotating = PendingRotation::exists($staff);

        return Inertia::render('Account/Index', [
            'account' => [
                'name' => $staff->name,
                'email' => $staff->email,
                'roles' => $staff->getRoleNames()->values()->all(),
                'two_factor_confirmed_at' => $staff->two_factor_confirmed_at?->toIso8601String(),
                'last_login_at' => self::time($staff->last_login_at),
                'rotation_expires_at' => $rotating && $staff->two_factor_pending_at !== null
                    ? $staff->two_factor_pending_at->copy()->addMinutes(config()->integer('speedclub.team.rotation_minutes'))->toIso8601String()
                    : null,
            ],
            'sessions' => fn (): array => $sessions->list($staff, $request->hasSession() ? $request->session()->getId() : null),
            'passwordMinLength' => config()->integer('speedclub.passwords.min_length'),
            'qaSample' => self::qaSample($request),
        ]);
    }

    /**
     * The visual matrix photographs the rotation's scan step and the recovery codes through `?qaStep=rotation|recovery`, outside production
     * only (as ADM-03, DQ-502): a made-up key and made-up codes that say so; nothing is started, shown or stored.
     *
     * @return array{step: string, svg: string, key: string, codes: list<string>, expires_at: string}|null
     */
    private static function qaSample(Request $request): ?array
    {
        $step = $request->query('qaStep');

        if (app()->environment('production') || ! in_array($step, ['rotation', 'recovery'], true)) {
            return null;
        }

        $key = 'SAMPLEKEYNOTREALSAMPLEKEYNOTREAL';
        $svg = (new Writer(new ImageRenderer(
            new RendererStyle(160, 0, null, null, Fill::uniformColor(new Rgb(255, 255, 255), new Rgb(0, 0, 0))),
            new SvgImageBackEnd,
        )))->writeString('otpauth://totp/SPEED%20CLUB%20Admin:beispiel%40speedclub.test?secret='.$key.'&issuer=SPEED%20CLUB%20Admin');

        return [
            'step' => $step,
            'svg' => trim(substr($svg, (int) strpos($svg, "\n") + 1)),
            'key' => $key,
            'codes' => array_map(fn (int $n): string => sprintf('BEISPIEL%02d-NICHTECHT', $n), range(1, 8)),
            'expires_at' => now()->addMinutes(config()->integer('speedclub.team.rotation_minutes'))->toIso8601String(),
        ];
    }

    private static function time(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? CarbonImmutable::parse($value, 'UTC')->toIso8601String() : ($value instanceof \DateTimeInterface ? CarbonImmutable::instance($value)->toIso8601String() : null);
    }
}
