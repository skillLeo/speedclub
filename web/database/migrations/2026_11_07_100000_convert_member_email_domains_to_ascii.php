<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

return new class extends Migration
{
    /**
     * Member addresses are stored with the domain in ASCII from now on (App\Support\EmailAddress), so max@müller.de and
     * max@xn--mller-kva.de are one account. This brings the rows written before into that form.
     *
     * When the ASCII form already belongs to another row, both accounts exist for real (one from the app, one from the browser) and
     * neither may be lost here: the row is left as it is and named in the log by its id only, for support to merge by hand.
     * The conversion is written out here rather than taken from the app class, so it stays what it was when this ran.
     */
    public function up(): void
    {
        DB::table('users')->select(['id', 'email'])->orderBy('id')->chunkById(500, function ($rows): void {
            foreach ($rows as $row) {
                $email = (string) $row->email;
                $ascii = $this->ascii($email);

                if ($ascii === $email) {
                    continue;
                }

                if (DB::table('users')->where('email', $ascii)->exists()) {
                    Log::warning('Member address not converted to ASCII: the ASCII form belongs to another account.', ['user_id' => $row->id]);

                    continue;
                }

                try {
                    DB::table('users')->where('id', $row->id)->update(['email' => $ascii]);
                } catch (UniqueConstraintViolationException) {
                    Log::warning('Member address not converted to ASCII: the ASCII form belongs to another account.', ['user_id' => $row->id]);
                }
            }
        });
    }

    /**
     * Nothing to undo: the unicode form of a converted address is not kept, and the ASCII form is the same mailbox.
     */
    public function down(): void {}

    private function ascii(string $email): string
    {
        $at = strrpos($email, '@');

        if ($at === false) {
            return $email;
        }

        $domain = substr($email, $at + 1);

        if ($domain === '' || preg_match('/[^\x00-\x7F]/', $domain) !== 1) {
            return $email;
        }

        $converted = idn_to_ascii($domain, IDNA_NONTRANSITIONAL_TO_ASCII, INTL_IDNA_VARIANT_UTS46);

        return is_string($converted) && $converted !== ''
            ? mb_strtolower(substr($email, 0, $at)).'@'.mb_strtolower($converted)
            : $email;
    }
};
