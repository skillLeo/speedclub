<?php

namespace App\Http\Controllers\Admin\System;

use App\Actions\Admin\System\RunIntegrationTest;
use App\Http\Controllers\Admin\Team\TeamResponses;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\System\Integrations;
use App\Services\Team\TeamRefused;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-50 integrations (06 §3 System: "status only, never show secrets"): mail, Pusher, Expo push, AI provider, Turnstile, Sentry as
 * configured or not, with the driver or provider name where that is harmless; never a key, host, user, token or address. The test buttons
 * (mail to me, Pusher event, AI call with the fake when no key; push stays disabled with its reason) answer with the outcome only.
 */
class IntegrationsController extends Controller
{
    use TeamResponses;

    public function index(Request $request, Integrations $integrations): Response
    {
        /** @var Staff $viewer */
        $viewer = $request->user('staff');

        return Inertia::render('System/Integrations', [
            'integrations' => fn (): array => $integrations->status($viewer),
            'lastTest' => fn (): ?array => $request->hasSession() && is_array($last = $request->session()->get('integration_test')) ? $last : null,
        ]);
    }

    public function test(Request $request, string $integration, RunIntegrationTest $run): RedirectResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        try {
            $result = match ($integration) {
                'mail' => $run->mail($staff, app()->getLocale()),
                'pusher' => $run->pusher($staff),
                'ai' => $run->ai($staff),
                default => $run->pushNotice($staff),
            };
        } catch (TeamRefused $refused) {
            return back(303)->with('error', $refused->getMessage());
        }

        // Only the outcome: ok, the exception's class name, and for the AI call whether the fake answered.
        $outcome = ['key' => $integration, 'ok' => $result['ok'], 'error' => $result['error'], 'faked' => (bool) ($result['faked'] ?? false), 'at' => now()->toIso8601String()];

        return back(303)->with('integration_test', $outcome)->with($result['ok'] ? 'success' : 'error', $result['ok'] ? "system.flash.test_ok_{$integration}" : 'system.flash.test_failed');
    }
}
