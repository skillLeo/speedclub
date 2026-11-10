<?php

namespace Tests\Fixtures\Arch;

use App\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * Violates every controller rule on purpose: tests/Arch/ArchRulesTest.php proves the rules catch it.
 */
class BadApiController
{
    public function model(User $user): User
    {
        $user->name = 'changed';
        $user->save();

        return $user;
    }

    /**
     * @return array<string, string>
     */
    public function plainArray(): array
    {
        return ['ok' => 'yes'];
    }

    public function untyped()
    {
        return User::create(['name' => 'x']);
    }

    public function nullable(): ?JsonResponse
    {
        return response()->json(['ok' => true]);
    }
}
