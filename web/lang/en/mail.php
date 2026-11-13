<?php

return [
    'code_note' => 'The code is valid for :minutes minutes. Didn’t ask for it? Then you can ignore this e-mail.',
    // M4.6 passwordless e-mail codes (09 §8.1).
    'email_code' => [
        'action' => 'Sign in',
        'same_device' => 'The button only works on the device where you asked for the code.',
        'sign_in' => [
            'subject' => ':code is your SPEED CLUB code',
            'heading' => 'Your sign-in code',
            'intro' => 'Enter this code in the app or tap “Sign in”.',
        ],
        'sign_up' => [
            'subject' => ':code is your SPEED CLUB code',
            'heading' => 'Welcome to SPEED CLUB',
            'intro' => 'Use this code to create your account. Enter it in the app or tap “Sign in”.',
        ],
        'link' => [
            'subject' => ':code confirms the connection',
            'heading' => 'Connect :provider to your account',
            'intro' => 'Someone wants to connect :provider to your SPEED CLUB account. If that was you, enter this code in the app. Otherwise ignore this e-mail and nothing changes.',
        ],
        'reauth' => [
            'subject' => ':code is your confirmation code',
            'heading' => 'Confirm it is you',
            'intro' => 'You are changing a security setting of your account. Enter this code in the app.',
        ],
        'change_email' => [
            'subject' => ':code confirms your new e-mail address',
            'heading' => 'Confirm your new e-mail address',
            'intro' => 'Enter this code in the app to confirm your new address.',
        ],
    ],
    'verification' => [
        'subject' => ':code is your SPEED CLUB code',
        'heading' => 'Confirm your e-mail address',
        'intro' => 'Enter this code in the app to confirm your account.',
        'action' => 'Confirm in the browser',
    ],
    'reset' => [
        'subject' => 'Your code to reset your password',
        'heading' => 'Set a new password',
        'intro' => 'Enter this code in the app and choose a new password.',
        'action' => 'Reset in the browser',
    ],
    'exists' => [
        'subject' => 'You already have a SPEED CLUB account',
        'heading' => 'This address already has an account',
        'intro' => 'Someone tried to create an account with this e-mail address. The account already exists. If that was you, sign in or reset your password.',
        'sign_in' => 'Sign in',
        'reset' => 'Forgot password',
        'note' => 'That was not you? Then there is nothing to do. Nothing has changed on your account.',
    ],
    'closing' => [
        'subject' => 'Your SPEED CLUB account is being deleted',
        'heading' => 'This address is still in use',
        'intro' => 'Someone tried to create an account with this e-mail address. The account it belongs to is deactivated and will be deleted for good within :days days of the deletion request. Until then the address cannot be used again.',
        'after' => 'After that the address is free, and you can register with it again.',
        'note' => 'Wasn\'t you? Then you don\'t need to do anything.',
    ],
    'email_change' => [
        'subject' => ':code is your code for the new address',
        'heading' => 'Confirm your new e-mail address',
        'intro' => 'You want to change the e-mail address of your SPEED CLUB account to this address. Enter this code in the app to finish the change.',
    ],
    'email_change_attempt' => [
        'subject' => 'Someone wanted to use this address for another account',
        'heading' => 'This address already belongs to your account',
        'intro' => 'Someone wanted to change the e-mail address of another SPEED CLUB account to this address. We did not allow it. Nothing changed on your account.',
        'note' => 'You don\'t need to do anything. If you are worried, write to us at :support.',
    ],
    'export' => [
        'subject' => 'Your data export is ready',
        'heading' => 'Your data is ready to download',
        'intro' => 'Your SPEED CLUB export is ready: a ZIP file with your data as JSON and the originals of your photos.',
        'valid' => 'The link works until :date. After that we delete the file, and you can request a new export.',
        'ends' => 'If you reset your password, change your e-mail address or sign out a device before then, the link ends. You will then find a new one in the app under Settings › Data › Export my data.',
        'action' => 'Download export',
        'note' => 'You didn\'t ask for an export? Then write to us at :support right away. Don\'t share the link: whoever has it can download the file.',
    ],
    'support' => [
        'subject' => 'We received your request',
        'heading' => 'Thanks, we received your message',
        'intro' => 'We received your request about “:category” and will get back to you, usually within two working days. If you wrote to us from the app, you’ll find the reply there under Settings › Help & FAQ › Your requests. Otherwise we reply by e-mail.',
        'reference' => 'Your reference: :reference',
        'note' => 'You didn\'t write to us? Then you can ignore this e-mail.',
    ],
    'security' => [
        'browser' => 'a browser',
        'action' => 'Reset password',
        'note' => 'Wasn’t you? In the app, go to Settings › Security and tap “This wasn’t me”. We’ll sign out every device and our support team will get in touch.',
        // M4.7 (09 §8.4): login alerts and new ways in.
        'when' => 'Time: :time',
        'when_where' => 'Time: :time · near :place',
        'secure_action' => 'This wasn\'t me',
        'secure_note' => 'Wasn’t you? Tap “This wasn’t me”. We’ll sign out every device and our support team will get in touch. If it was you, there’s nothing to do.',
        'removed' => 'We removed what was added after the reported sign-in: :items. If any of it was yours, set it up again once you are signed in.',
        'account_secured' => [
            'subject' => 'Your account has been secured',
            'heading' => 'We secured your account',
            'intro' => 'You reported a sign-in as “This wasn’t me”. Every device and browser is now signed out. Your request number is :reference; our support team will get in touch.',
            'after' => 'Sign in again and change your password if you have one. Check under Settings › Sign-in & passkeys which sign-in methods are connected to your account.',
            'note' => 'Questions? Write to us at :support.',
            'action' => 'Contact support',
        ],
        'email_code_locked' => [
            'subject' => 'Too many wrong codes',
            'heading' => 'Code sign-in paused for now',
            'intro' => 'A wrong sign-in code was entered for your account too often. To protect you, we accept no codes for 15 minutes.',
        ],
        'provider_linked' => [
            'subject' => 'New sign-in method connected',
            'heading' => 'A sign-in method was connected',
            'intro' => 'A new sign-in method is now connected to your account (:device).',
        ],
        'provider_unlinked' => [
            'subject' => 'Sign-in method removed',
            'heading' => 'A sign-in method was removed',
            'intro' => 'A sign-in method was removed from your account (:device).',
        ],
        'passkey_added' => [
            'subject' => 'New passkey for your account',
            'heading' => 'A passkey was added',
            'intro' => 'A passkey was just added to your account (:device).',
        ],
        'passkey_removed' => [
            'subject' => 'Passkey removed',
            'heading' => 'A passkey was removed',
            'intro' => 'A passkey was just removed from your account (:device).',
        ],
        'passkey_rejected' => [
            'subject' => 'Passkey sign-in refused',
            'heading' => 'We refused a passkey sign-in',
            'intro' => 'A sign-in with your passkey :device looked like it came from a copy of the key. We refused it. Remove the passkey in settings and create a new one.',
        ],
        'new_device' => [
            'subject' => 'New sign-in to SPEED CLUB',
            'heading' => 'New sign-in on a device',
            'intro' => 'Your account was just signed in on :device, which we had not seen before.',
        ],
        'password_changed' => [
            'subject' => 'Your password was changed',
            'heading' => 'Your password was changed',
            'intro' => 'The password of your account was just changed. All devices were signed out.',
            'intro_kept' => 'The password of your account was just changed on :device. Other browsers were signed out; the app stays signed in on your other devices.',
            'intro_others_signed_out' => 'The password of your account was just changed on :device. All other devices were signed out.',
        ],
        'email_changed' => [
            'subject' => 'Your e-mail address was changed',
            'heading' => 'Your e-mail address was changed',
            'intro' => 'The e-mail address of your account was just changed. This message goes to the previous address.',
            // M3.2: support changed it after checking the member's identity; both addresses get this.
            'intro_staff' => 'Our support team changed the e-mail address of your account at your request after checking your identity. This message goes to the previous and the new address.',
            // The reset code would go to the new, maybe hijacked address: this mail sends the member to support instead.
            'note' => 'Wasn’t you? Don’t reset your password yourself in this case: the code would go to the new address. Instead, go to Settings › Security in the app and tap “This wasn’t me”, or write to us at :support. We will secure your account.',
            'action' => 'Write to support',
        ],
        'two_factor_changed' => [
            'subject' => 'Two-factor protection changed',
            'heading' => 'Your two-factor protection was changed',
            'intro' => 'Two-factor protection for your account was just turned on or off.',
            // M3.2: support reset it (four-eyes) after checking the member's identity.
            'intro_reset_by_staff' => 'Our support team reset the two-factor protection of your account at your request. Signing in no longer asks for a code; you can set the protection up again under Settings › Security.',
            'intro_enabled' => 'Two-factor protection is now on for your account. Every sign-in asks for a code from your authenticator app.',
            'intro_disabled' => 'Two-factor protection was just turned off for your account. From now on, signing in no longer asks for a code.',
            'intro_recovery_codes' => 'New recovery codes were just created for your account. The old ones no longer work.',
        ],
        'verification_failed' => [
            'subject' => 'Failed verification attempt',
            'heading' => 'Wrong entry on your account',
            'intro' => 'A security check for your account was just answered incorrectly on :device.',
            'intro_second_factor' => 'The password of your account was just entered correctly on :device, but the two-factor code was wrong.',
            'intro_password' => 'A wrong password was just entered on :device for a change to your account.',
            'intro_locked' => 'The two-factor code was entered incorrectly too many times. Until you reset your password by e-mail, nobody can sign in to your account.',
        ],
        'recovery_code_used' => [
            'subject' => 'Sign-in with a recovery code',
            'heading' => 'A recovery code was used',
            'intro' => 'Your account was just signed in on :device with a recovery code. You have :count unused codes left. Create new ones under Settings › Security › Two-factor protection.',
        ],
        'sessions_revoked' => [
            'subject' => 'Devices were signed out',
            'heading' => 'Devices were signed out of your account',
            'intro' => 'Other devices or browsers were just signed out of your account on :device.',
            // M3.2: support signed every device out.
            'intro_staff' => 'Our team signed your account out on every device and browser for your protection. Please sign in again.',
        ],
        'deletion_requested' => [
            'subject' => 'Your account will be deleted',
            'heading' => 'Deletion of your account was requested',
            'intro' => 'Your account is now deactivated: your profile and vehicles can no longer be seen, your QR stickers no longer work and all devices are signed out. We will delete the account and all photos for good within :days days.',
            'after' => 'The deletion cannot be undone. In conversations, the other person still sees your messages, shown as from “Deleted member”. If you requested a data export before, you can still download it for up to 7 days through the link in the export e-mail.',
            'note' => 'Wasn’t you? Write to us at :support right away.',
            'action' => 'Write to support',
        ],
    ],
    // M3.2: staff took a vehicle's QR code down or issued a new one (ADM-19). :title is the build's title.
    'qr_staff' => [
        'revoked' => [
            'subject' => 'We blocked your QR code',
            'heading' => 'Your QR code is blocked',
            'intro' => 'Our team blocked the QR code of your build :title. Anyone scanning the sticker now sees “no longer valid”.',
            'after' => 'Only our team can issue a new code. Write to us if you need one.',
        ],
        'reissued' => [
            'subject' => 'Your build has a new QR code',
            'heading' => 'New QR code for your build',
            'intro' => 'Our team issued a new QR code for your build :title. The old sticker is no longer valid.',
            'after' => 'You can download and print the new sticker in the app under your build.',
        ],
        'note' => 'Questions? Write to :support.',
    ],
];
