<?php

// M2.4 messaging: validation texts, push texts and the e-mail digest. Pushes never quote a message unless the member turned previews on
// (ADR-035); requests never do. The digest never quotes one.
return [
    'photo_unknown' => 'This photo no longer exists. Upload it again.',
    'photo_not_ready' => 'The photo is still being processed. Try again in a moment.',
    'vehicle_unavailable' => 'You cannot share this vehicle right now.',
    'recipient_self' => 'You cannot write to yourself.',
    'pin_limit' => 'You can pin at most :max conversations.',
    'push' => [
        'new_message' => 'New message from @:name',
        'message_request' => '@:name would like to write to you',
        'photo' => 'Photo',
        'vehicle' => 'Vehicle',
    ],
    'digest' => [
        'subject' => 'Unread messages on SPEED CLUB',
        'heading' => 'You have unread messages',
        'intro' => '{1} A message has been waiting for you in one conversation for more than 12 hours.|[2,*] Messages have been waiting for you in :count conversations for more than 12 hours.',
        'action' => 'Open messages',
        'note' => 'You get this e-mail because you turned on the summary for messages. You can turn it off in the app under Settings › Notifications.',
    ],
];
