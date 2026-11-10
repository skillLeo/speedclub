<?php

namespace App\Actions\Admin\System;

use App\Enums\SystemEvent;
use App\Mail\SystemTestMail;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Ai\AiGateway;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\System\Integrations;
use App\Services\System\SystemTestAgent;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Broadcasting\BroadcastManager;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * ADM-50 test buttons (`integrations.view`, m3.6 §1). Each answers {ok, ...} and is audited with its outcome only; a failure names the
 * exception class, never its message (transport messages quote hosts and addresses).
 * - mail(): a test mail to the staff member's own address, sent now so the answer tells whether the mailer took it;
 * - push(): staff register no device tokens, so it is refused (`no_device`) and the page shows the button disabled with that reason;
 * - pusher(): a `system.test` event on the private channel `admin-test.{staff id}`; refused when Pusher is not configured;
 * - ai(): one short prompt to the configured provider, or to the SDK's fake when there is none (`faked: true`).
 *
 * @throws AuthorizationException|TeamRefused
 */
class RunIntegrationTest
{
    public function __construct(private readonly AuthMailer $mailer, private readonly BroadcastManager $broadcast, private readonly AiGateway $ai) {}

    /**
     * @return array{ok: bool, error: string|null}
     */
    public function mail(Staff $by, string $locale = 'de'): array
    {
        StaffAtoms::ensure($by, 'integrations.view');
        $mailer = (string) config('mail.default');

        if (! $this->mailer->mayDeliver()) {
            throw new TeamRefused('not_configured');
        }

        try {
            Mail::to($by->email)->locale(in_array($locale, config('speedclub.locales'), true) ? $locale : 'de')->send(new SystemTestMail($mailer));
            $result = ['ok' => true, 'error' => null];
        } catch (Throwable $failure) {
            $result = ['ok' => false, 'error' => class_basename($failure)];
        }

        Audit::record(SystemEvent::TestMailSent->value, null, after: ['mailer' => $mailer, ...$result], actor: $by);

        return $result;
    }

    /**
     * @throws TeamRefused
     */
    public function pushNotice(Staff $by): never
    {
        StaffAtoms::ensure($by, 'integrations.view');

        throw new TeamRefused('no_device');
    }

    /**
     * @return array{ok: bool, error: string|null, channel: string}
     */
    public function pusher(Staff $by): array
    {
        StaffAtoms::ensure($by, 'integrations.view');

        if (! Integrations::pusherConfigured()) {
            throw new TeamRefused('not_configured');
        }

        $channel = 'private-admin-test.'.$by->getKey();

        try {
            $this->broadcast->connection('pusher')->broadcast([$channel], 'system.test', ['sent_at' => now()->toIso8601String()]);
            $result = ['ok' => true, 'error' => null];
        } catch (Throwable $failure) {
            $result = ['ok' => false, 'error' => class_basename($failure)];
        }

        Audit::record(SystemEvent::TestPusherSent->value, null, after: $result, actor: $by);

        return [...$result, 'channel' => $channel];
    }

    /**
     * @return array{ok: bool, error: string|null, faked: bool, provider: string|null, answer: string|null}
     */
    public function ai(Staff $by): array
    {
        StaffAtoms::ensure($by, 'integrations.view');
        $faked = ! $this->ai->available();
        $provider = $faked ? null : $this->ai->provider();

        if ($faked) {
            SystemTestAgent::fake(['OK']);
        }

        // Through the gateway (M3.7): the same provider, model and timeout as every feature, and an ai_calls row.
        $result = [...$this->ai->probe($by), 'faked' => $faked, 'provider' => $provider];
        $result = ['ok' => $result['ok'], 'error' => $result['error'], 'faked' => $faked, 'provider' => $provider, 'answer' => $result['answer']];

        Audit::record(SystemEvent::TestAiRun->value, null, after: ['ok' => $result['ok'], 'faked' => $faked, 'provider' => $provider, 'error' => $result['error']], actor: $by);

        return $result;
    }
}
