<?php

namespace App\Services\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Enums\DecisionAction;
use App\Models\Block;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\DataExport;
use App\Models\Decision;
use App\Models\Follow;
use App\Models\KnownDevice;
use App\Models\ModerationCase;
use App\Models\PersonalAccessToken;
use App\Models\Report;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Audit\Audit;
use App\Services\Support\PiiReveals;
use App\Support\ViewAs;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The read side of the member record ADM-10 (m3.2-contract §1a, §2): plain arrays for the admin pages, dates as ISO 8601 (the page
 * formats them in Berlin), never a password, secret, IP address, user agent or message content.
 *
 * - overview(): profile, status, restrictions with their end and decision, counters, consents; the address always masked
 *   (`can_reveal_pii` says whether the viewer may reveal it, SF-2 / SEC-P3-02);
 * - revealPii(): the full address for `members.view_pii`, audited `member.pii_viewed` with the reason when one is given (the "show"
 *   click, a POST); the only place the address leaves this class;
 * - security(): two-factor state, every token with device, platform, created and last used (view-as ones flagged), known devices by
 *   first and last sign-in (a fingerprint is never shown), whether a password change is forced;
 * - messageMetadata(): `members.message_metadata` only, audited `member.message_metadata_viewed`: counts, no content (no body anywhere);
 * - reports(): as reporter and as the member a case is about, with case ids;
 * - privacy(): consents, data exports (with who asked: the member or staff), the deletion state.
 */
class MemberRecord
{
    /**
     * @return array<string, mixed>
     */
    public function overview(User $member, Staff $viewer): array
    {
        $restrictions = is_array($member->restrictions) ? $member->restrictions : [];
        $decisionIds = array_values(array_filter(array_map(fn (array $row): ?string => $row['decision_id'] ?? null, $restrictions), is_string(...)));
        $decisions = Decision::query()->whereIn('id', $decisionIds)->get(['id', 'action', 'decided_at', 'decided_by'])->keyBy('id');

        return [
            'id' => $member->id,
            'username' => $member->username,
            'display_name' => $member->getAttribute('display_name'),
            'bio' => $member->getAttribute('bio'),
            'city' => $member->getAttribute('city'),
            // Masked for everybody (SF-2, SEC-P3-02): the address itself only comes from revealPii(), audited.
            'email' => self::maskEmail($member->email),
            'email_masked' => true,
            'can_reveal_pii' => $viewer->isActive() && $viewer->can('members.view_pii'),
            'email_verified_at' => self::iso($member->getAttribute('email_verified_at')),
            'status' => $member->status->value,
            'suspended' => $member->isSuspended(),
            'pending_deletion' => $member->isPendingDeletion(),
            'restrictions' => array_map(function (string $type) use ($restrictions, $decisions): array {
                $row = $restrictions[$type];
                $decision = is_string($row['decision_id'] ?? null) ? $decisions->get($row['decision_id']) : null;

                return [
                    'type' => $type,
                    'until' => is_string($row['until'] ?? null) ? $row['until'] : null,
                    'decision_id' => $decision?->id,
                    'decided_at' => $decision instanceof Decision ? $decision->decided_at->toIso8601String() : null,
                ];
            }, array_keys($restrictions)),
            'counters' => [
                'vehicles' => Vehicle::query()->where('owner_id', $member->id)->count(),
                'followers' => Follow::query()->where('followee_id', $member->id)->count(),
                'following' => Follow::query()->where('follower_id', $member->id)->count(),
                'reports_as_target' => ModerationCase::query()->where('subject_id', $member->id)->count(),
                'decisions' => Decision::query()->where('subject_id', $member->id)->where('action', '!=', DecisionAction::NoAction->value)->count(),
            ],
            'consents' => $this->consents($member),
            'signup_ref' => $member->getAttribute('signup_ref'),
            'two_factor' => $member->hasTwoFactor(),
            'created_at' => self::iso($member->getAttribute('created_at')),
            'last_seen_at' => self::iso($member->getAttribute('last_seen_at')),
        ];
    }

    /**
     * @return array{email: string}
     *
     * @throws AuthorizationException
     */
    public function revealPii(User $member, Staff $viewer, ?string $reason = null): array
    {
        StaffAtoms::ensure($viewer, 'members.view_pii');
        // SEC-P3-21: a daily cap per staff member, shared with the web-contact reveal.
        PiiReveals::ensureAllowed($viewer);

        DB::transaction(fn () => Audit::record(AdminMemberEvent::PiiViewed->value, $member, after: ['fields' => ['email']], reason: $reason, actor: $viewer));

        return ['email' => $member->email];
    }

    /**
     * @return array<string, mixed>
     */
    public function security(User $member): array
    {
        $tokens = PersonalAccessToken::query()
            ->where('tokenable_type', $member->getMorphClass())
            ->where('tokenable_id', $member->id)
            ->orderByDesc('last_used_at')
            ->orderByDesc('id')
            ->limit(100)
            ->get();

        $agents = Schema::hasTable('sessions')
            ? DB::table('sessions')->where('user_id', $member->id)->orderByDesc('last_activity')->limit(200)->pluck('user_agent')
            : [];
        $labels = DeviceLabel::index($tokens, $agents);

        return [
            'two_factor' => [
                'on' => $member->hasTwoFactor(),
                'confirmed_at' => self::iso($member->getAttribute('two_factor_confirmed_at')),
                'locked_at' => self::iso($member->getAttribute('two_factor_locked_at')),
            ],
            'force_password_change' => $member->getAttribute('force_password_change') === true,
            'devices' => $tokens->map(fn (PersonalAccessToken $token): array => [
                'id' => $token->id,
                'device_name' => $token->deviceName(),
                'platform' => $token->getAttribute('platform')?->value,
                'app_version' => $token->getAttribute('app_version'),
                'view_as' => ViewAs::isToken($token),
                'created_at' => self::iso($token->getAttribute('created_at')),
                'last_used_at' => self::iso($token->getAttribute('last_used_at')),
                'expires_at' => self::iso($token->getAttribute('expires_at')),
            ])->values()->all(),
            // Sign-ins by device, from known_devices: when first and last seen, and the device's name where the member's own tokens or
            // browser sessions give one (DeviceLabel, DQ-541). The fingerprint is a hash and stays out, like any user agent or IP.
            'sign_ins' => KnownDevice::query()->where('user_id', $member->id)->orderByDesc('last_seen_at')->limit(50)->get()
                ->map(fn (KnownDevice $device): array => [
                    'first_seen_at' => self::iso($device->getAttribute('created_at')),
                    'last_seen_at' => self::iso($device->getAttribute('last_seen_at')),
                    ...DeviceLabel::for($device, $labels),
                ])->values()->all(),
        ];
    }

    /**
     * Counts only: no message text, no conversation partner, no preview.
     *
     * @return array{conversations: int, requests_sent_7_days: int, requests_sent_30_days: int, requests_accepted_30_days: int, accepted_rate_30_days: float|null, blocks_given: int, blocks_received: int}
     *
     * @throws AuthorizationException
     */
    public function messageMetadata(User $member, Staff $viewer): array
    {
        StaffAtoms::ensure($viewer, 'members.message_metadata');

        $sent = fn (int $days) => Conversation::query()->where('created_by', $member->id)->where('created_at', '>=', now()->subDays($days));
        $sent30 = (clone $sent(30))->count();
        $accepted30 = (clone $sent(30))
            ->whereExists(fn ($query) => $query->selectRaw('1')->from('conversation_participants')
                ->whereColumn('conversation_participants.conversation_id', 'conversations.id')
                ->where('conversation_participants.user_id', '!=', $member->id)
                ->whereNotNull('conversation_participants.accepted_at'))
            ->count();

        $metadata = [
            'conversations' => ConversationParticipant::query()->where('user_id', $member->id)->count(),
            'requests_sent_7_days' => $sent(7)->count(),
            'requests_sent_30_days' => $sent30,
            'requests_accepted_30_days' => $accepted30,
            'accepted_rate_30_days' => $sent30 === 0 ? null : round($accepted30 / $sent30, 3),
            'blocks_given' => Block::query()->where('blocker_id', $member->id)->count(),
            'blocks_received' => Block::query()->where('blocked_id', $member->id)->count(),
        ];

        DB::transaction(fn () => Audit::record(AdminMemberEvent::MessageMetadataViewed->value, $member, actor: $viewer));

        return $metadata;
    }

    /**
     * @return array{as_reporter: list<array<string, mixed>>, as_target: list<array<string, mixed>>}
     */
    public function reports(User $member): array
    {
        $asReporter = Report::query()
            ->where('reporter_id', $member->id)
            ->with('case:id,status')
            ->latest('created_at')
            ->limit(50)
            ->get(['id', 'case_id', 'target_type', 'target_label', 'reason', 'created_at'])
            ->map(fn (Report $report): array => [
                'id' => $report->id,
                'case_id' => $report->case_id,
                'case_status' => $report->case?->status->value,
                'target_type' => $report->target_type->value,
                'target_label' => $report->target_label,
                'reason' => $report->reason->value,
                'created_at' => self::iso($report->getAttribute('created_at')),
            ])->values()->all();
        $asReporter = array_values($asReporter);

        $asTarget = ModerationCase::query()
            ->where('subject_id', $member->id)
            ->with('decision:id,case_id,action,decided_at,reverses_decision_id')
            ->latest('created_at')
            ->limit(50)
            ->get()
            ->map(fn (ModerationCase $case): array => [
                'case_id' => $case->id,
                'origin' => $case->origin->value,
                'status' => $case->status->value,
                'target_type' => $case->target_type->value,
                'target_label' => $case->target_label,
                'report_count' => $case->report_count,
                'created_at' => self::iso($case->getAttribute('created_at')),
                'decision' => $case->decision instanceof Decision ? [
                    'id' => $case->decision->id,
                    'action' => $case->decision->action->value,
                    'decided_at' => $case->decision->decided_at->toIso8601String(),
                    'reverses_decision_id' => $case->decision->reverses_decision_id,
                ] : null,
            ])->values()->all();

        return ['as_reporter' => $asReporter, 'as_target' => array_values($asTarget)];
    }

    /**
     * @return array<string, mixed>
     */
    public function privacy(User $member): array
    {
        $requested = $member->getAttribute('deletion_requested_at');

        return [
            'consents' => $this->consents($member),
            'exports' => DataExport::query()->where('user_id', $member->id)->latest('requested_at')->limit(20)->get()
                ->map(fn (DataExport $export): array => [
                    'id' => $export->id,
                    'status' => $export->status->value,
                    'for_staff' => $export->isForStaff(),
                    'requested_by_staff_id' => $export->requested_by_staff_id,
                    'requested_at' => self::iso($export->requested_at),
                    'ready_at' => self::iso($export->ready_at),
                    'expires_at' => self::iso($export->expires_at),
                ])->values()->all(),
            'deletion' => [
                'requested_at' => self::iso($requested),
                'hard_delete_by' => $requested instanceof DateTimeInterface
                    ? CarbonImmutable::instance($requested)->addDays(config()->integer('speedclub.account_deletion.hard_delete_after_days'))->toIso8601String()
                    : null,
            ],
        ];
    }

    /**
     * "lena@gmail.de" → "l***@g***.de": first letter of the local part and of the domain, and the top-level domain.
     */
    public static function maskEmail(string $email): string
    {
        $at = strrpos($email, '@');

        if ($at === false) {
            return '***';
        }

        $local = substr($email, 0, $at);
        $domain = substr($email, $at + 1);
        $dot = strrpos($domain, '.');
        $tld = $dot === false ? '' : substr($domain, $dot);
        $host = $dot === false ? $domain : substr($domain, 0, $dot);

        return mb_substr($local, 0, 1).'***@'.mb_substr($host, 0, 1).'***'.$tld;
    }

    /**
     * @return array{terms_version: mixed, privacy_version: mixed, consented_at: string|null, marketing_consent_at: string|null}
     */
    private function consents(User $member): array
    {
        return [
            'terms_version' => $member->getAttribute('terms_version'),
            'privacy_version' => $member->getAttribute('privacy_version'),
            'consented_at' => self::iso($member->getAttribute('consented_at')),
            'marketing_consent_at' => self::iso($member->getAttribute('marketing_consent_at')),
        ];
    }

    private static function iso(mixed $value): ?string
    {
        return $value instanceof DateTimeInterface ? CarbonImmutable::instance($value)->toIso8601String() : null;
    }
}
