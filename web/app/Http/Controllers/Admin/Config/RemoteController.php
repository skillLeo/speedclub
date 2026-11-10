<?php

namespace App\Http\Controllers\Admin\Config;

use App\Enums\ConfigKey;
use App\Http\Controllers\Admin\Config\Support\ConfigEditor;
use App\Http\Controllers\Controller;
use App\Models\Release;
use App\Models\Staff;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-37 Remote-Konfiguration (06 §3, m3.5 §2): min and latest version per platform, the force-update message DE/EN and maintenance mode
 * with its DE/EN message, as the remote_config draft. Turning maintenance on is four-eyes (`maintenance.enable`); off is immediate. The
 * team keeps working through its signed preview token (the staff bypass); members have none.
 */
class RemoteController extends Controller
{
    public function __invoke(Request $request, ConfigEditor $editor): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Config/Remote', [
            'editor' => $editor->props(ConfigKey::RemoteConfig, $staff),
            'latestRelease' => Release::query()->where('channel', 'production')->orderByDesc('released_at')->orderByDesc('version_code')->value('version_name'),
            'maintenanceAtom' => $staff->can('maintenance.toggle'),
        ]);
    }
}
