<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Enums\DigestFrequency;
use App\Enums\DistanceUnit;
use App\Enums\MentionPrivacy;
use App\Enums\PowerDisplay;
use App\Enums\ThemePreference;
use App\Enums\TorqueUnit;
use App\Enums\WeightUnit;
use App\Enums\WhoCanMessage;
use App\Services\Maintenance\MaintenancePrefs;
use App\Services\Notifications\NotificationPrefs;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateSettingsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'theme' => ['sometimes', 'required', Rule::enum(ThemePreference::class)],
            // SET-11: "system" follows the device; the device language (Accept-Language) becomes the language of mails and pushes.
            'locale' => ['sometimes', 'required', Rule::in([...config()->array('speedclub.locales'), 'system'])],
            // SET-11 "Region für in deiner Nähe" (09 §8.7): a city the member picked (place search), or null to clear it. The point is
            // stored snapped to the 0.05° grid of event areas; it is never shown to anybody else.
            'home_region' => ['sometimes', 'nullable', 'array:label,lat,lng'],
            'home_region.label' => ['required_with:home_region', 'string', 'min:2', 'max:80'],
            'home_region.lat' => ['required_with:home_region', 'numeric', 'between:-90,90'],
            'home_region.lng' => ['required_with:home_region', 'numeric', 'between:-180,180'],
            'power_display' => ['sometimes', 'required', Rule::enum(PowerDisplay::class)],
            // M4.13 SET-11 (09 §8.11): display units only; nothing stored changes its unit.
            'distance_unit' => ['sometimes', 'required', Rule::enum(DistanceUnit::class)],
            'torque_unit' => ['sometimes', 'required', Rule::enum(TorqueUnit::class)],
            'weight_unit' => ['sometimes', 'required', Rule::enum(WeightUnit::class)],
            // M4.13 SET-23: any part; the rest stays.
            'maintenance' => ['sometimes', 'required', 'array:hu_au_lead_days,tyre_reminders,insurance_reminder,service_reminders'],
            'maintenance.hu_au_lead_days' => ['sometimes', 'required', 'array', 'min:1', 'max:'.MaintenancePrefs::MAX_LEADS],
            'maintenance.hu_au_lead_days.*' => ['integer', 'distinct', 'min:0', 'max:'.MaintenancePrefs::MAX_LEAD_DAYS],
            'maintenance.tyre_reminders' => ['sometimes', 'required', 'boolean:strict'],
            'maintenance.insurance_reminder' => ['sometimes', 'required', 'boolean:strict'],
            'maintenance.service_reminders' => ['sometimes', 'required', 'boolean:strict'],
            // Account-wide: off names the owner to nobody but the owner on WEB-01, VEH-01, feed cards and the sticker PDF (ADR-148 a).
            'show_owner_on_qr' => ['sometimes', 'required', 'boolean:strict'],
            // SET-07 privacy (M2.5), each with an effect: messaging starts and requests, member search, search engines, read receipts.
            'who_can_message' => ['sometimes', 'required', Rule::enum(WhoCanMessage::class)],
            // M4.11 (09 §8.5): "Wer darf mich erwähnen".
            'mention_privacy' => ['sometimes', 'required', Rule::enum(MentionPrivacy::class)],
            'discoverable' => ['sometimes', 'required', 'boolean:strict'],
            'indexable' => ['sometimes', 'required', 'boolean:strict'],
            'read_receipts' => ['sometimes', 'required', 'boolean:strict'],
            // M3.7 SET privacy "KI-Vorschläge": the opt-in of the [AI] suggestion features (02 §6), off by default.
            'ai_suggestions' => ['sometimes', 'required', 'boolean:strict'],
            ...$this->notificationRules(),
        ];
    }

    /**
     * SET-09 (M2.5 screen): any part may be sent, the rest stays. Every level refuses keys it does not know (422), so a typo never
     * silently keeps a push switched on.
     *
     * @return array<string, mixed>
     */
    private function notificationRules(): array
    {
        $types = NotificationPrefs::types();
        $rules = [
            'notification_prefs' => ['sometimes', 'required', 'array:types,quiet_hours,message_previews,digest_frequency'],
            'notification_prefs.types' => ['sometimes', 'required', 'array:'.implode(',', array_keys($types))],
            'notification_prefs.quiet_hours' => ['sometimes', 'required', 'array:enabled,from,to'],
            'notification_prefs.quiet_hours.enabled' => ['sometimes', 'required', 'boolean:strict'],
            'notification_prefs.quiet_hours.from' => ['sometimes', 'required', 'string', 'regex:'.NotificationPrefs::TIME_PATTERN],
            'notification_prefs.quiet_hours.to' => ['sometimes', 'required', 'string', 'regex:'.NotificationPrefs::TIME_PATTERN],
            // Push previews of messages (ADR-035), off by default.
            'notification_prefs.message_previews' => ['sometimes', 'required', 'boolean:strict'],
            // Phase 4 SET-09: how often the e-mail digest of messages may go out.
            'notification_prefs.digest_frequency' => ['sometimes', 'required', Rule::enum(DigestFrequency::class)],
        ];

        foreach ($types as $type => $channels) {
            $rules["notification_prefs.types.$type"] = ['sometimes', 'required', 'array:'.implode(',', array_keys($channels))];

            foreach (array_keys($channels) as $channel) {
                $rules["notification_prefs.types.$type.$channel"] = ['sometimes', 'required', 'boolean:strict'];
            }
        }

        return $rules;
    }
}
