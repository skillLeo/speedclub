<?php

// Push texts of M2.2, rendered in the recipient's language by App\Services\Notifications\NotificationTexts. The app renders the list rows
// (HOME-02) itself from type, actors and actor_count. Never message content (ADR-035).
return [
    'title' => 'Speedclub',
    'new_follower' => '{1} @:name now follows you.|{2} @:name and one other now follow you.|[3,*] @:name and :count others now follow you.',
    'followed_published' => [
        'vehicle' => '@:name published a new build: :vehicle',
        'update' => '@:name posted an update to :vehicle.',
    ],
    'build_saved' => '{1} A member saved your :vehicle last week.|[2,*] :count members saved your :vehicle last week.',
    // M2.6, urgent: names nothing of the decision; the app opens SAFE-01.
    'moderation_decision' => 'We made a decision about your content or account. Tap to read the reasons.',
    // M2.7 [SIG]: scans in total, never who scanned.
    'qr_milestone' => 'The sticker on :vehicle has been scanned :count times.',
    'hu_au_reminder' => 'The HU/AU inspection for :vehicle is due in :month.',
    // M3.3: the member's catalogue request (ADM-14). In-app only; the app renders the row itself.
    'catalog_request' => [
        'accepted' => 'Your vehicle is now in the catalogue: :vehicle.',
        'rejected' => 'We did not add your catalogue request for :vehicle. Tap to see why.',
    ],
    // Phase 3 (SET-15): the team answered a support request. In-app only; the app renders the row itself, never the answer's text.
    // M4.7 (09 §8.4): the login alert, pushed to the account's other devices. Names the device only.
    'security_new_device' => 'New sign-in to Speedclub on :device. Wasn\'t you? Tap to secure your account.',
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
        // R5-5: a comment on the car itself.
        'vehicle' => '{1} @:name commented on your build :vehicle.|{2} @:name and one other member commented on your build :vehicle.|[3,*] @:name and :count others commented on your build :vehicle.',
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
        'reopened' => '":name" is being reviewed again and is not public until then.',
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
    // SEC-414-01: team invitations (in-app only).
    'business_invite' => [
        'invited' => '":name" invited you to their team. Accept or decline the invitation.',
        'removed' => '":name" removed you from their team.',
        'accepted' => ':username is now on the team of ":name".',
        'declined' => ':username declined the invitation to the team of ":name".',
        'left' => ':username left the team of ":name".',
    ],
    // R4-2.3 Crews (in-app only).
    'crew' => [
        'request_received' => ':username would like to join the crew “:name”. Accept or decline the request.',
        'request_approved' => 'You are now in the crew “:name”.',
        'invited' => ':username invites you to the crew “:name”.',
    ],
    // M5.9b STREET DEX: the owner's own car, the day's count and, where allowed, its city; never who spotted it.
    'spot_alert' => [
        'city' => '{1} Your :vehicle was spotted in :city today.|[2,*] Your :vehicle was spotted :count times in :city today.',
        'cities' => '[0,*] Your :vehicle was spotted :count times in :cities cities today.',
        'plain' => '{1} Your :vehicle was spotted today.|[2,*] Your :vehicle was spotted :count times today.',
    ],
    // M5.9d supporting system: push texts (the in-app list writes its own) and the SET-09 category labels of the gift types.
    'badge_unlocked' => 'New badge: “:name”.',
    'car_of_the_day_owner' => 'Your :vehicle is today’s Car of the Day and leads Home until 6 pm tomorrow.',
    'car_of_the_day' => 'Car of the Day: :vehicle by :name.',
    'invite_accepted' => 'Someone joined with your invite :code. You both have the “Crew Starter” badge now.',
    'categories' => [
        'spots' => 'Spots',
        'badges' => 'Badges',
        'car_of_the_day' => 'Car of the Day',
        'invites' => 'Invites',
        // M5.8.
        'forum' => 'Forum',
        // M5.6.
        'events_nearby' => 'Meets near you',
        // M5.7.
        'build_prompts' => 'Build reminders',
        'weekly_recap' => 'Weekly recap',
    ],
    // M5.8 Forum (m5.8-contract §5): the thread's public title, never the text of a post.
    'forum_reply' => [
        'thread' => '{1} @:name replied to “:title”.|{2} @:name and one other member replied to “:title”.|[3,*] @:name and :count others replied to “:title”.',
        'post' => '@:name replied to your post in “:title”.',
    ],
    'forum_mention' => '@:name mentioned you in “:title”.',
    'forum_solved' => 'Your answer in “:title” was marked as the solution.',
    // M5.6 events (m5.6-contract §4.6, §6): the number of photos waiting, never who sent them; the weekly nearby meets.
    'event_gallery_pending' => '{1} A new photo of “:title” is waiting for your approval.|[2,*] :count new photos of “:title” are waiting for your approval.',
    'event_nearby' => [
        'title' => 'New meets near you',
        'body' => '{1} :title in the next two weeks.|{2} :title and one more in the next two weeks.|[3,*] :title and :count more in the next two weeks.',
    ],
    'event_nearby_mail' => [
        'subject' => 'New meets near you',
        'heading' => 'New meets near you',
        'intro' => '{1} A new meet around :region was added this week:|[2,*] :count new meets around :region were added this week:',
        'line' => ':date · :city · :title',
        'more' => '{1} You will find one more in the app.|[2,*] You will find :count more in the app.',
        'action' => 'See the meets',
        'unsubscribe' => 'Unsubscribe from these e-mails',
        'note' => 'You get this e-mail because you switched on “New meets near you” under Settings › Notifications. The link above unsubscribes you; your mail app often offers “Unsubscribe” for it too.',
        'region' => 'your region',
    ],
    // M5.7 Engagement (10 §6.2, §6.3, m5.7-contract §4.2, §6): the build prompt and the weekly recap. Never a zero, never a comparison with
    // last week, never who; no guilt.
    'plan_due' => 'Is the :mod on the car yet? Add it.',
    'weekly_recap' => [
        'title' => 'Your week at Speedclub',
        'parts' => [
            'views' => '{1} 1 view|[2,*] :count views',
            'sticker_scans' => '{1} 1 sticker scan|[2,*] :count sticker scans',
            'new_followers' => '{1} 1 new follower|[2,*] :count new followers',
            'spots' => '{1} 1 spot|[2,*] :count spots',
            'maintenance_due' => '{1} 1 service due soon|[2,*] :count services due soon',
            'events_nearby' => '{1} 1 meet near you|[2,*] :count meets near you',
        ],
    ],
    'weekly_recap_mail' => [
        'subject' => 'Your week at Speedclub',
        'heading' => 'Your week at Speedclub',
        'intro' => 'Here is what happened around your builds:',
        'action' => 'See your stats',
        'unsubscribe' => 'Stop the weekly recap e-mails',
        'note' => 'You get this e-mail because the weekly recap is on and no push reached you this week. The link above stops these e-mails; in the app under Settings › Notifications you can switch the weekly recap off completely.',
    ],
];
