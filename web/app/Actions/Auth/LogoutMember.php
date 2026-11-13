<?php

namespace App\Actions\Auth;

use App\Models\PersonalAccessToken;
use App\Models\PushSubscription;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class LogoutMember
{
    /**
     * Ends this sign-in only: the token of this device, or this browser's session. Right after a rotation the device has two
     * tokens (RotateMemberToken), and both go: the other one must not outlive the sign-out by its grace period. So does the push token
     * of that device, and the Web Push subscription of that browser.
     */
    public function handle(User $user, Request $request): void
    {
        $token = $user->currentAccessToken();

        if ($token instanceof PersonalAccessToken) {
            $device = $token->deviceId();
            $token->onSameDevice()->delete();

            // The device stops getting this member's pushes (M2.2). The app also unregisters itself, but may be offline.
            if ($device !== null) {
                $user->pushTokens()->where('device_id', $device)->delete();
            }

            return;
        }

        // M4.15: this browser's Web Push ends with its sign-in (the member web also drops it itself, but may be offline).
        $user->pushSubscriptions()->where('session_key', PushSubscription::sessionKey($request->session()->getId()))->delete();

        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
    }
}
