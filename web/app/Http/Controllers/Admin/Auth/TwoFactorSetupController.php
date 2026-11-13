<?php

namespace App\Http\Controllers\Admin\Auth;

use App\Http\Controllers\Controller;
use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Models\Staff;
use BaconQrCode\Renderer\Color\Rgb;
use BaconQrCode\Renderer\Image\SvgImageBackEnd;
use BaconQrCode\Renderer\ImageRenderer;
use BaconQrCode\Renderer\RendererStyle\Fill;
use BaconQrCode\Renderer\RendererStyle\RendererStyle;
use BaconQrCode\Writer;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * ADM-03 enrolment (mandatory unless STAFF_2FA_REQUIRED=false, then skippable per session). The page gets no secret: it asks for the password, then fetches the QR code and the key from Fortify,
 * one request after the other (SEC-P1-41), and shows the recovery codes once after the confirmation.
 */
class TwoFactorSetupController extends Controller
{
    public function __invoke(Request $request): Response|RedirectResponse
    {
        $staff = $request->user('staff');

        if ($staff instanceof Staff && $staff->hasEnabledTwoFactorAuthentication()) {
            return redirect()->route('admin.dashboard');
        }

        $response = Inertia::render('Auth/TwoFactorSetup', [
            'passwordConfirmed' => $request->session()->has('auth.password_confirmed_at')
                && time() - (int) $request->session()->get('auth.password_confirmed_at') < config()->integer('auth.password_timeout', 10800),
            'qaSample' => self::qaSample($request),
            // STAFF_2FA_REQUIRED=false: the page offers "Später einrichten" (route admin.two-factor.skip).
            'skippable' => EnsureStaffTwoFactor::skippable(),
        ])->toResponse($request);

        $response->headers->set('Cache-Control', 'no-store, private');

        return $response;
    }

    /**
     * DQ-502: the visual matrix photographs the scan and recovery steps through `?qaStep=scan|recovery`, outside production only. The
     * key and codes are made up and say so; they belong to no account, and nothing is enabled or stored.
     *
     * @return array{step: string, svg: string, key: string, codes: list<string>}|null
     */
    private static function qaSample(Request $request): ?array
    {
        $step = $request->query('qaStep');

        if (app()->environment('production') || ! in_array($step, ['scan', 'recovery'], true)) {
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
        ];
    }
}
