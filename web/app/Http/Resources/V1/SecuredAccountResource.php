<?php

namespace App\Http\Resources\V1;

use App\Support\Security\SecuredAccount;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer to "Das war ich nicht": every device is signed out, this one too.
 *
 * @property SecuredAccount $resource
 */
class SecuredAccountResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** Always true: sign in again. */
            'signed_out' => true,
            /** The support request that was opened ("SC-7H2KQXMB"). */
            'ticket_reference' => $this->resource->reference,
            'devices_signed_out' => $this->resource->devices,
            'sessions_signed_out' => $this->resource->sessions,
            /** The next sign-in with the password asks for a new one by e-mail code. */
            'password_reset_required' => $this->resource->passwordReset,
            /**
             * What was removed because it was added since the reported sign-in (SEC-M47-01): passkeys and provider links (counts), a pending
             * e-mail change, and a second factor turned on since then. The app lists them on the confirmation.
             */
            'removed' => $this->resource->removed,
        ];
    }
}
