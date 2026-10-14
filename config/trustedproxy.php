<?php

return [
    /*
     * Reverse proxies whose X-Forwarded-* headers are trusted, read by Laravel's TrustProxies middleware.
     * Comma-separated IPs/CIDRs, or "*" to trust the calling proxy. Unset means no proxy is trusted.
     */
    'proxies' => env('TRUSTED_PROXIES') ?: null,
];
