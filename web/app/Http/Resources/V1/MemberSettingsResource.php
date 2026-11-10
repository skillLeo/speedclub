<?php

namespace App\Http\Resources\V1;

use App\Enums\PowerDisplay;
use App\Enums\ThemePreference;
use App\Enums\WhoCanMessage;
use App\Models\User;
use App\Services\Notifications\NotificationPrefs;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property User $resource
 */
class MemberSettingsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var ThemePreference */
            'theme' => $this->resource->getAttribute('theme'),
            /** @var string */
            'locale' => $this->resource->getAttribute('locale'),
            /** @var PowerDisplay */
            'power_display' => $this->resource->getAttribute('power_display'),
            /**
             * Whether the pages a sticker leads to name the member (GAR-12). Off: nobody but the member sees the owner on the
             * public vehicle page, on feed cards or on the sticker PDF (ADR-148 a). Account-wide, not per vehicle.
             */
            'show_owner_on_qr' => $this->resource->getAttribute('show_owner_on_qr') !== false,
            /**
             * SET-07 (M2.5): who may start a conversation or send a request (MessagingEligibility). An accepted conversation stays open.
             *
             * @var WhoCanMessage
             */
            'who_can_message' => $this->resource->getAttribute('who_can_message') ?? WhoCanMessage::Everyone,
            /** SET-07: shown in member search, Aktive Mitglieder and suggestions. */
            'discoverable' => $this->resource->getAttribute('discoverable') !== false,
            /** SET-07: search engines may list the profile and the builds (robots meta on /u and /v, the sitemap). */
            'indexable' => $this->resource->getAttribute('indexable') !== false,
            /** SET-07 [SIG sig.msg_read_receipts]: send and see read receipts; both sides must have it on. */
            'read_receipts' => $this->resource->getAttribute('read_receipts') !== false,
            /**
             * SET privacy "KI-Vorschläge" (M3.7, 02 §6): AI suggestions in search, the mod form, photo upload and the description, each
             * labelled "KI-Vorschlag". Off by default; the AI provider named on the privacy policy processes the text or photo sent.
             * Translations run on an explicit tap and need no opt-in.
             */
            'ai_suggestions' => $this->resource->getAttribute('ai_suggestions') === true,
            /**
             * SET-09 (02_PRODUCT_SPEC §7): push switch per type (plus the e-mail digest of messages and the HU/AU e-mail), quiet hours in
             * Europe/Berlin, and push previews of messages (ADR-035). Always complete: unset values are the defaults of the matrix.
             *
             * @var array{types: array{new_follower: array{push: bool}, followed_published: array{push: bool}, build_saved: array{push: bool}, new_message: array{push: bool, email_digest: bool}, message_request: array{push: bool}, hu_au_reminder: array{push: bool, email: bool}, qr_milestone: array{push: bool}}, quiet_hours: array{enabled: bool, from: string, to: string}, message_previews: bool}
             */
            'notification_prefs' => NotificationPrefs::for($this->resource),
        ];
    }
}
