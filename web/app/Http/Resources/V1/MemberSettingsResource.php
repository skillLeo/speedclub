<?php

namespace App\Http\Resources\V1;

use App\Enums\DistanceUnit;
use App\Enums\MentionPrivacy;
use App\Enums\PowerDisplay;
use App\Enums\ThemePreference;
use App\Enums\TorqueUnit;
use App\Enums\WeightUnit;
use App\Enums\WhoCanMessage;
use App\Models\User;
use App\Services\Maintenance\MaintenancePrefs;
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
            /**
             * SET-11: de, en, or "system" when the app follows the device language.
             *
             * @var 'de'|'en'|'system'
             */
            'locale' => $this->resource->getAttribute('locale_follows_system') === true ? 'system' : $this->resource->getAttribute('locale'),
            /**
             * The language of mails and pushes (de or en). With "system" it is the device language of the last change.
             *
             * @var string
             */
            'effective_locale' => (string) $this->resource->getAttribute('locale'),
            /**
             * SET-11 region for "in deiner Nähe" (09 §8.7): the city the member picked and its point, snapped to 0.05°. Home's
             * nearby events and EVT-01 `near=home` use it when the device gives no location. Private: only you read it.
             *
             * @var array{label: string, lat: float, lng: float}|null
             */
            'home_region' => ($point = $this->resource->homeRegionPoint()) === null ? null : [
                'label' => (string) $this->resource->getAttribute('home_region_label'),
                'lat' => $point[0],
                'lng' => $point[1],
            ],
            /** @var PowerDisplay */
            'power_display' => $this->resource->getAttribute('power_display'),
            /**
             * SET-11 (09 §8.11): units the app shows; the server keeps km, Nm, kg and euro cents.
             *
             * @var DistanceUnit
             */
            'distance_unit' => $this->resource->getAttribute('distance_unit') ?? DistanceUnit::Km,
            /** @var TorqueUnit */
            'torque_unit' => $this->resource->getAttribute('torque_unit') ?? TorqueUnit::Nm,
            /** @var WeightUnit */
            'weight_unit' => $this->resource->getAttribute('weight_unit') ?? WeightUnit::Kg,
            /**
             * SET-23 = MNT-03 (M4.13): reminder defaults. hu_au_lead_days: what a new HU/AU item starts with (days, longest first); the
             * switches silence tyre (O bis O), insurance (Stichtag 30.11.) and service-type reminders. Push/e-mail: SET-09 hu_au_reminder.
             *
             * @var array{hu_au_lead_days: list<int>, tyre_reminders: bool, insurance_reminder: bool, service_reminders: bool}
             */
            'maintenance' => MaintenancePrefs::for($this->resource),
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
            /**
             * M4.11 (09 §8.5) "Wer darf mich erwähnen": everyone, followers (members who follow me) or nobody. A mention that is not
             * allowed stays plain text, without a link or a notification.
             *
             * @var MentionPrivacy
             */
            'mention_privacy' => $this->resource->getAttribute('mention_privacy') ?? MentionPrivacy::Everyone,
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
             * SET-09 (02_PRODUCT_SPEC §7, 09 §7.12): push and web_push (member web) switches per type, plus the e-mail digest of messages
             * and the HU/AU and event e-mails; quiet hours in Europe/Berlin; push previews of messages (ADR-035); how often the message
             * digest may go out (daily · weekly). Always complete: unset values are the defaults of the matrix.
             *
             * @var array{types: array{new_follower: array{push: bool, web_push: bool}, followed_published: array{push: bool, web_push: bool}, build_saved: array{push: bool, web_push: bool}, new_message: array{push: bool, email_digest: bool, web_push: bool}, message_request: array{push: bool, web_push: bool}, hu_au_reminder: array{push: bool, email: bool, web_push: bool}, qr_milestone: array{push: bool, web_push: bool}, reaction: array{push: bool, web_push: bool}, mention: array{push: bool, web_push: bool}, comment: array{push: bool, web_push: bool}, vehicle_follower: array{push: bool, web_push: bool}, event_reminder: array{push: bool, email: bool, web_push: bool}, event_update: array{push: bool, web_push: bool}}, quiet_hours: array{enabled: bool, from: string, to: string}, message_previews: bool, digest_frequency: 'daily'|'weekly'}
             */
            'notification_prefs' => NotificationPrefs::for($this->resource),
        ];
    }
}
