<?php

// Push texts of M2.2, rendered in the recipient's language by App\Services\Notifications\NotificationTexts. The app renders the list rows
// (HOME-02) itself from type, actors and actor_count. Never message content (ADR-035).
return [
    'title' => 'SPEED CLUB',
    'new_follower' => '{1} @:name now follows you.|{2} @:name and one other now follow you.|[3,*] @:name and :count others now follow you.',
    'followed_published' => [
        'vehicle' => '@:name published a new build: :vehicle',
        'update' => '@:name posted an update to :vehicle.',
    ],
    'build_saved' => '{1} A member saved your :vehicle last week.|[2,*] :count members saved your :vehicle last week.',
    // M2.6, urgent: names nothing of the decision; the app opens SAFE-01.
    'moderation_decision' => 'We made a decision about your content or account. Tap to read the reasons.',
    // M2.7 [SIG]: scans in total, never who scanned.
    'qr_milestone' => 'The QR code on :vehicle has been scanned :count times.',
    'hu_au_reminder' => 'The HU/AU inspection for :vehicle is due in :month.',
    // M3.3: the member's catalogue request (ADM-14). In-app only; the app renders the row itself.
    'catalog_request' => [
        'accepted' => 'Your vehicle is now in the catalogue: :vehicle.',
        'rejected' => 'We did not add your catalogue request for :vehicle. Tap to see why.',
    ],
    // Phase 3 (SET-15): the team answered a support request. In-app only; the app renders the row itself, never the answer's text.
    'support_reply' => 'The support team replied to your request :reference.',
    // The e-mail of the HU/AU reminder, only when switched on in SET-09.
    'hu_au_mail' => [
        'subject' => 'HU/AU inspection for :vehicle in :month',
        'heading' => 'Your HU/AU inspection is due soon',
        'intro' => 'The HU/AU inspection for :vehicle is due in :month. Book an appointment in good time.',
        'action' => 'Open vehicle',
        'note' => 'You get this e-mail because you switched it on under Settings › Notifications. You can switch it off there too.',
    ],
];
