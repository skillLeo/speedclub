<?php

namespace App\Http\Csp;

use Illuminate\Support\Facades\Storage;

final class MediaSources
{
    /**
     * The origin of an S3-compatible media bucket. The public disk is same-origin and needs no entry.
     *
     * @return list<string>
     */
    public static function hosts(): array
    {
        $disk = config()->string('speedclub.media.disk');

        if (config('filesystems.disks.'.$disk.'.driver') === 'local') {
            return [];
        }

        $parts = parse_url(Storage::disk($disk)->url(''));

        return isset($parts['scheme'], $parts['host']) ? [$parts['scheme'].'://'.$parts['host']] : [];
    }
}
