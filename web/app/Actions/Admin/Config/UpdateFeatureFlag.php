<?php

namespace App\Actions\Admin\Config;

use App\Enums\ContentEvent;
use App\Models\FeatureFlag;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Ai\AiGateway;
use App\Services\AppConfig\AppConfig;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use App\Services\Config\ConfigRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * ADM-36 ⚿ (`flags.manage`, reason): change a flag. Flags are defined in code (FeatureFlagSeeder); the admin edits their state:
 * `environments` {local, staging, production} (each environment has its own database, so only this environment's value takes effect
 * and mirrors into `enabled`; the others document the intended state), `staff_only`, `percentage` (0–100, member flags; a stable hash
 * of flag key and member id, FeatureFlags::forMember()), `critical`, `description`. They live in `rules`.
 *
 * Rules: an `ai.*` flag cannot be switched on without an AI provider and its key (AiGateway::available(), ADR-031 / 02 §6); a change to a
 * flag that is or becomes critical, in production, is four-eyes (`flags.critical_change`), its handler calls execute(). Every change
 * writes `flag.changed` with before/after and flushes AppConfig, so GET app-config answers with a new ETag.
 */
final class UpdateFeatureFlag
{
    private const ENVIRONMENTS = ['local', 'staging', 'production'];

    public function __construct(private readonly Approvals $approvals, private readonly AppConfig $appConfig) {}

    /**
     * @param  array<string, mixed>  $changes
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $staff, FeatureFlag $flag, array $changes, string $reason): FlagOutcome
    {
        StaffAtoms::ensure($staff, 'flags.manage');
        $reason = Reason::required($reason);
        $next = $this->validated($flag, $changes);

        if (app()->environment('production') && ($this->state($flag)['critical'] || $next['critical'])) {
            return new FlagOutcome(approval: $this->approvals->request('flags.critical_change', [
                'flag_id' => (int) $flag->getKey(),
                'changes' => $changes,
                'updated_at' => $flag->updated_at?->toIso8601ZuluString() ?? '',
            ], $reason, $staff, $flag));
        }

        return new FlagOutcome($this->apply($staff, null, $flag, $changes, $reason));
    }

    /**
     * The approved change: only from the `flags.critical_change` handler while Approvals::approve() executes that request.
     *
     * @param  array<string, mixed>  $changes
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function execute(Staff $requester, Staff $approver, FeatureFlag $flag, array $changes, string $reason): FeatureFlag
    {
        $request = FourEyes::executor(['flags.critical_change'], $requester, $approver, 'flags.manage');

        if ((int) ($request->payload['flag_id'] ?? 0) !== (int) $flag->getKey() || ($request->payload['changes'] ?? null) !== $changes) {
            throw new AuthorizationException('The approval names another change.');
        }

        return $this->apply($requester, $approver, $flag, $changes, $reason);
    }

    /**
     * The flag's state after $changes, validated.
     *
     * @param  array<array-key, mixed>  $changes
     * @return array{enabled: bool, environments: array<string, bool>, staff_only: bool, percentage: int, critical: bool, description: string|null}
     *
     * @throws ValidationException|ConfigRefused
     */
    public function validated(FeatureFlag $flag, array $changes): array
    {
        $data = Validator::make($changes, [
            'enabled' => ['sometimes', 'boolean'],
            'environments' => ['sometimes', 'array:'.implode(',', self::ENVIRONMENTS)],
            'environments.*' => ['boolean'],
            'staff_only' => ['sometimes', 'boolean'],
            'percentage' => ['sometimes', 'integer', 'between:0,100'],
            'critical' => ['sometimes', 'boolean'],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
        ])->validate();

        if ($data === []) {
            throw ValidationException::withMessages(['changes' => [(string) __('content.flags.empty')]]);
        }

        $state = self::state($flag);
        $here = self::environment();

        foreach ($data['environments'] ?? [] as $environment => $on) {
            $state['environments'][(string) $environment] = (bool) $on;
        }

        if (array_key_exists('enabled', $data)) {
            $state['environments'][$here] = (bool) $data['enabled'];
        }

        $state['enabled'] = $state['environments'][$here];
        $state['staff_only'] = (bool) ($data['staff_only'] ?? $state['staff_only']);
        $state['percentage'] = (int) ($data['percentage'] ?? $state['percentage']);
        $state['critical'] = (bool) ($data['critical'] ?? $state['critical']);
        $state['description'] = array_key_exists('description', $data) ? $data['description'] : $state['description'];

        // M3.7: a provider and its key (AiGateway::available()); a provider name alone would switch on features that only fail.
        if (str_starts_with((string) $flag->getAttribute('key'), 'ai.') && $state['enabled'] && ! app(AiGateway::class)->available()) {
            throw new ConfigRefused('ai_provider_missing');
        }

        return $state;
    }

    /**
     * @return array{enabled: bool, environments: array<string, bool>, staff_only: bool, percentage: int, critical: bool, description: string|null}
     */
    public static function state(FeatureFlag $flag): array
    {
        /** @var array<string, mixed> $rules */
        $rules = $flag->getAttribute('rules') ?? [];
        $enabled = $flag->getAttribute('enabled') === true;
        $stored = is_array($rules['environments'] ?? null) ? $rules['environments'] : [];
        $environments = [];

        foreach (self::ENVIRONMENTS as $environment) {
            $environments[$environment] = $environment === self::environment() ? $enabled : ($stored[$environment] ?? false) === true;
        }

        $description = $flag->getAttribute('description');

        return [
            'enabled' => $enabled,
            'environments' => $environments,
            'staff_only' => ($rules['staff_only'] ?? false) === true,
            'percentage' => is_numeric($rules['percentage'] ?? null) ? max(0, min(100, (int) $rules['percentage'])) : 100,
            'critical' => ($rules['critical'] ?? false) === true,
            'description' => is_string($description) ? $description : null,
        ];
    }

    /** This deployment's column of `environments` (testing and anything else count as local). */
    public static function environment(): string
    {
        $environment = (string) app()->environment();

        return in_array($environment, ['staging', 'production'], true) ? $environment : 'local';
    }

    /**
     * @param  array<string, mixed>  $changes
     */
    private function apply(Staff $requester, ?Staff $approver, FeatureFlag $flag, array $changes, string $reason): FeatureFlag
    {
        return DB::transaction(function () use ($requester, $approver, $flag, $changes, $reason): FeatureFlag {
            $locked = FeatureFlag::query()->whereKey($flag->getKey())->lockForUpdate()->firstOrFail();
            $before = self::state($locked);
            $after = $this->validated($locked, $changes);
            /** @var array<string, mixed> $rules */
            $rules = $locked->getAttribute('rules') ?? [];

            $locked->forceFill([
                'enabled' => $after['enabled'],
                'description' => $after['description'],
                'rules' => [
                    ...$rules,
                    'environments' => $after['environments'],
                    'staff_only' => $after['staff_only'],
                    'percentage' => $after['percentage'],
                    'critical' => $after['critical'],
                ],
            ])->save();

            DB::afterCommit(fn () => $this->appConfig->flush());

            Audit::record(ContentEvent::FlagChanged->value, $locked,
                before: ['key' => $locked->getAttribute('key'), ...$before],
                after: ['key' => $locked->getAttribute('key'), ...$after, 'requested_by' => $requester->getKey(), 'approved_by' => $approver?->getKey()],
                reason: $reason, actor: $approver ?? $requester);

            return $locked;
        });
    }
}
