<?php

namespace App\Support;

/**
 * Crawlers, link previews, monitors and HTTP libraries. A browser or an in-app browser always sends a user agent, so an empty
 * one counts as a machine. This is about honest counts, not defence: anybody can send any user agent.
 *
 * No app names whose in-app browser a person scans with: Snapchat, LinkedIn, Pinterest, X, Telegram and Discord put their
 * name into the user agent of that browser, while their preview fetchers already say bot (Snap URL Preview Service; bot,
 * LinkedInBot, Pinterestbot, Twitterbot, TelegramBot, Discordbot, Slackbot, Slack-ImgProxy …/robots). Only fetchers without such
 * a word are named: WhatsApp's has none, and WhatsApp opens links in the system browser. "Cubot" is a phone maker whose model
 * names reach the user agent of every WebView.
 */
final class KnownBots
{
    private const PATTERN = '~(?<!cu)bot\b|bot/|bots\b|crawl|spider|slurp|mediapartners|facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp/|skypeuripreview|embedly|vkshare|preview|lighthouse|pagespeed|gtmetrix|headless|phantomjs|puppeteer|playwright|selenium|uptime|pingdom|monitor|statuscake|nagios|zabbix|curl|wget|httpie|python|go-http-client|okhttp|java/|libwww|guzzle|axios|node-fetch|undici|scrapy|feedfetcher|archive\.org|ia_archiver|semrush|ahrefs|mj12|petalbot|bytespider|perplexity~i';

    public static function matches(?string $userAgent): bool
    {
        return $userAgent === null || trim($userAgent) === '' || preg_match(self::PATTERN, $userAgent) === 1;
    }
}
