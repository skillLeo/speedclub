<?php

namespace App\Http\Controllers\Admin\Content;

use App\Enums\ConfigKey;
use App\Http\Controllers\Admin\Config\Support\ConfigEditor;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-30 Ankündigungen (06 §3, m3.5 §2): the in-app banners as the announcements draft — title/body DE/EN, CTA (internal path or https
 * URL), audience, schedule, dismissible, tone. Saving and publishing go through ConfigDraftController.
 */
class AnnouncementsController extends Controller
{
    public function __invoke(Request $request, ConfigEditor $editor): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Content/Announcements', [
            'editor' => $editor->props(ConfigKey::Announcements, $staff),
            'max' => config()->integer('speedclub.content.announcements_max'),
        ]);
    }
}
