<?php

namespace App\Http\Controllers\Admin\Team;

use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Services\Config\ConfigRefused;
use App\Services\Team\TeamOutcome;
use App\Services\Team\TeamRefused;
use Closure;
use Illuminate\Http\RedirectResponse;

/**
 * How the M3.6 controllers answer a step (Team, privacy, system, account, settings, memberships): a refusal of the rules (TeamRefused,
 * ConfigRefused) comes back as the flash `error` (TeamRefused carries its text in the admin's locale, a config refusal its admin key); a
 * four-eyes request as the flash `approval` the shell shows as ApprovalNotice; anything else as the flash `success` key. Validation and
 * authorisation errors keep Laravel's own answers (422 errors bag, 403 page).
 */
trait TeamResponses
{
    /**
     * @param  Closure(): mixed  $step
     */
    protected function step(Closure $step, string $success): RedirectResponse
    {
        try {
            $result = $step();
        } catch (TeamRefused $refused) {
            return back(303)->with('error', $refused->getMessage());
        } catch (ConfigRefused $refused) {
            return back(303)->with('error', $refused->getMessage());
        }

        if ($result instanceof TeamOutcome && $result->approval !== null) {
            $response = back(303)->with('approval', ApprovalsGateway::flash($result->approval));

            return $result->applied ? $response->with('success', $success) : $response;
        }

        return back(303)->with('success', $success);
    }
}
