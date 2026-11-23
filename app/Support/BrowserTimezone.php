<?php

namespace App\Support;

use DateTimeZone;
use Error;
use IntlTimeZone;

/** A timezone name reported by a browser (Intl.DateTimeFormat().resolvedOptions().timeZone), as one PHP can use. */
final class BrowserTimezone
{
    /**
     * The name itself when PHP knows it, else its current IANA name, else null (offsets and abbreviations included).
     *
     * Browsers report ICU's names, which are often the legacy ones (Chrome says Asia/Calcutta, Asia/Saigon). PHP's
     * bundled database knows those, but Debian and Ubuntu builds read the system tzdata, which since 2024 leaves
     * them to the optional tzdata-legacy package: there Asia/Calcutta is unknown, so ICU maps it to Asia/Kolkata.
     */
    public static function resolve(mixed $name): ?string
    {
        if (! is_string($name) || $name === '') {
            return null;
        }

        $known = DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC);
        if (in_array($name, $known, true)) {
            return $name;
        }

        if (class_exists(IntlTimeZone::class)) {
            try {
                $iana = IntlTimeZone::getIanaID($name);
            } catch (Error) {
                $iana = false; // PHP 8.4's intl has getIanaID only when built with ICU 74+
            }
            if (is_string($iana) && in_array($iana, $known, true)) {
                return $iana;
            }
        }

        return null;
    }
}
