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
    // M4.7 (09 §8.4): the login alert, pushed to the account's other devices. Names the device only.
    'security_new_device' => 'New sign-in to SPEED CLUB on :device. Wasn\'t you? Tap to secure your account.',
    'support_reply' => 'The support team replied to your request :reference.',
    // The e-mail of the HU/AU reminder, only when switched on in SET-09.
    'hu_au_mail' => [
        'subject' => 'HU/AU inspection for :vehicle in :month',
        'heading' => 'Your HU/AU inspection is due soon',
        'intro' => 'The HU/AU inspection for :vehicle is due in :month. Book an appointment in good time.',
        'action' => 'Open vehicle',
        'note' => 'You get this e-mail because you switched it on under Settings › Notifications. You can switch it off there too.',
    ],
    // M4.11 (09 §8.17): names who and which build, never a count for anybody but the owner, never what was written.
    'reaction' => [
        'build_update' => '{1} @:name reacted to your update on :vehicle.|{2} @:name and one other member reacted to your update on :vehicle.|[3,*] @:name and :count others reacted to your update on :vehicle.',
        'vehicle' => '{1} @:name reacted to your build :vehicle.|{2} @:name and one other member reacted to your build :vehicle.|[3,*] @:name and :count others reacted to your build :vehicle.',
    ],
    'mention' => [
        'update' => '@:name mentioned you in an update on :vehicle.',
        'comment' => '@:name mentioned you in a comment on :vehicle.',
    ],
    'comment' => [
        'update' => '{1} @:name commented on your update on :vehicle.|{2} @:name and one other member commented on your update on :vehicle.|[3,*] @:name and :count others commented on your update on :vehicle.',
        'reply' => '@:name replied to your comment on :vehicle.',
    ],
    'vehicle_follower' => '{1} @:name now follows your build :vehicle.|{2} @:name and one other member now follow your build :vehicle.|[3,*] @:name and :count others now follow your build :vehicle.',
    // M4.12 (09 §8.17): the event's title and start, never an update's text or a rejection reason in a push.
    'event_review' => [
        'approved' => '“:title” is approved and now visible.',
        'rejected' => '“:title” was not approved. You find the reason on the meet.',
    ],
    'event_promoted' => 'A spot opened up: you are now going to “:title”.',
    'event_reminder' => [
        '24h' => 'Tomorrow at :time: “:title”.',
        '2h' => 'Starting in two hours: “:title” at :time.',
    ],
    'event_update' => [
        'update' => 'News from the organiser of “:title”.',
        'changed' => 'The time or place of “:title” has changed.',
    ],
    'event_cancelled' => '“:title” has been cancelled.',
    'event_reminder_mail' => [
        'subject_24h' => 'Tomorrow: :title',
        'subject_2h' => 'In two hours: :title',
        'heading' => 'Your meet is coming up',
        'intro' => '“:title” starts on :date at :time. You find the place, the rules and updates on the meet.',
        'action' => 'Open meet',
        'note' => 'You get this e-mail because you are going to this meet and switched on e-mail reminders under Settings › Notifications.',
    ],
    // M4.13 (09 §8.8): maintenance reminders, the owner's own vehicle and item (MaintenanceTexts); SET-09 "Due dates".
    'maintenance_due' => [
        'items' => [
            'service' => 'The service',
            'oil_change' => 'The oil change',
            'brake_fluid' => 'The brake fluid change',
        ],
        'custom' => '":title"',
        'date' => ':item for :vehicle is due on :date.',
        'today' => ':item for :vehicle is due today.',
        'km' => ':item for :vehicle is due at :km.',
        'undated' => ':item for :vehicle is coming up.',
        'hu_au' => 'The HU/AU inspection for :vehicle is due in :month.',
        'tyres_winter' => 'Time for winter tyres on :vehicle. Change them by :date.',
        'tyres_summer' => 'Time for summer tyres on :vehicle. Change them by :date.',
        'insurance' => 'Cut-off date :date: until then you can cancel and switch the car insurance for :vehicle.',
    ],
    'maintenance_mail' => [
        'subject' => 'Due: maintenance for :vehicle',
        'heading' => 'Something is due soon',
        'action' => 'Open maintenance',
        'note' => 'You are getting this e-mail because you switched on e-mails about due dates under Settings › Notifications. You can switch them off there too.',
    ],
    // M4.14 businesses (09 §8.10), in-app only.
    'business_review' => [
        'verified' => '":name" is verified and now public.',
        'rejected' => '":name" was not verified. You will find the reason in your business dashboard.',
        'suspended' => '":name" is suspended and no longer public. You will find the reason in your business dashboard.',
        'reinstated' => '":name" is live again.',
    ],
    'business_tag' => [
        'business' => [
            'requested' => 'New tag for ":name": confirm the install on the :vehicle.',
            'accepted' => 'The install on the :vehicle is confirmed and now in your portfolio.',
            'declined' => 'The tag on the :vehicle was declined.',
        ],
        'member' => [
            'requested' => '":name" would like to add your :vehicle to their portfolio. Confirm the install.',
            'accepted' => '":name" confirmed the install on your :vehicle.',
            'declined' => '":name" declined the tag on your :vehicle.',
        ],
    ],
];
