<?php

namespace App\Actions\Admin\Privacy;

use App\Enums\PrivacyEvent;
use App\Enums\PrivacyRequestSource;
use App\Enums\PrivacyRequestStatus;
use App\Enums\PrivacyRequestType;
use App\Models\PrivacyRequest;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Privacy\PrivacyDeadlines;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * ADM-45 "Anfrage erfassen" (`privacy.process`): a GDPR request from a member (user_id) or an external requester (name and address).
 * received_at defaults to now and lies at most a year back; due_at is one month later (PrivacyDeadlines). The audit row carries type,
 * source and member, never the address or the request text.
 *
 * @throws AuthorizationException|ValidationException
 */
class CreatePrivacyRequest
{
    /**
     * @param  array<string, mixed>  $input  type, source, user_id?, requester_name?, requester_email?, locale?, details?, received_at?
     */
    public function handle(Staff $by, array $input): PrivacyRequest
    {
        StaffAtoms::ensure($by, 'privacy.process');

        $data = Validator::make($input, [
            'type' => ['required', Rule::enum(PrivacyRequestType::class)],
            'source' => ['required', Rule::enum(PrivacyRequestSource::class)],
            'user_id' => ['nullable', 'string', 'size:26', Rule::exists('users', 'id')],
            'requester_name' => ['nullable', 'string', 'max:160'],
            'requester_email' => ['required_without:user_id', 'nullable', 'string', 'email:rfc', 'max:191'],
            'locale' => ['nullable', Rule::in(config('speedclub.locales'))],
            'details' => ['nullable', 'string', 'max:5000'],
            'received_at' => ['nullable', 'date', 'before_or_equal:now', 'after:'.now()->subYear()->toIso8601String()],
        ])->validate();

        $received = isset($data['received_at']) ? Carbon::parse((string) $data['received_at'])->utc() : now();

        return DB::transaction(function () use ($by, $data, $received): PrivacyRequest {
            $request = new PrivacyRequest;
            $request->forceFill([
                'type' => $data['type'],
                'status' => PrivacyRequestStatus::Open,
                'source' => $data['source'],
                'user_id' => $data['user_id'] ?? null,
                'requester_name' => $data['requester_name'] ?? null,
                'requester_email' => isset($data['requester_email']) ? mb_strtolower(trim((string) $data['requester_email'])) : null,
                'locale' => $data['locale'] ?? 'de',
                'details' => $data['details'] ?? null,
                'received_at' => $received,
                'due_at' => PrivacyDeadlines::dueFor($received),
                'created_by' => $by->getKey(),
            ])->save();

            Audit::record(PrivacyEvent::RequestCreated->value, $request, after: [
                'type' => $request->type->value,
                'source' => $request->source->value,
                'user_id' => $request->user_id,
                'received_at' => $request->received_at->toIso8601String(),
                'due_at' => $request->due_at->toIso8601String(),
            ], actor: $by);

            return $request;
        });
    }
}
