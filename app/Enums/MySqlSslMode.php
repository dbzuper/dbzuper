<?php

namespace App\Enums;

use App\Database\Exceptions\InvalidConnectionOption;

/**
 * TLS for MySQL and MariaDB connections (options.mysql_ssl). PostgreSQL keeps its own options.sslmode.
 *
 * Connections saved before the mode existed have no mysql_ssl: a CA path meant "verify the certificate"
 * (unless ssl_verify was false, which only encrypted), no CA path meant no TLS.
 */
enum MySqlSslMode: string
{
    /** No TLS. */
    case Disabled = 'disabled';

    /** TLS on, the server certificate is not checked (no CA needed; a CA path is ignored). */
    case Required = 'required';

    /** TLS on, the certificate chain is checked against the CA file and the host name against the certificate. */
    case VerifyIdentity = 'verify_identity';

    /** The stored mode, or the one a connection saved before the mode existed behaves as. Unknown values pass through. */
    public static function effective(array $options): string
    {
        $mode = $options['mysql_ssl'] ?? null;
        if ($mode !== null && $mode !== '') {
            return is_scalar($mode) ? (string) $mode : '';
        }
        $ca = $options['ssl_ca'] ?? null;
        if ($ca === null || $ca === '') {
            return self::Disabled->value;
        }

        // The same cast the driver applied to ssl_verify before the mode existed.
        return (bool) ($options['ssl_verify'] ?? true) ? self::VerifyIdentity->value : self::Required->value;
    }

    /** The mode to connect with; fails closed (no silent fallback to plain text) on an unusable value. */
    public static function fromOptions(array $options): self
    {
        $mode = self::tryFrom(self::effective($options))
            ?? throw new InvalidConnectionOption('Unknown SSL mode.');
        if ($mode === self::VerifyIdentity && blank($options['ssl_ca'] ?? null)) {
            throw new InvalidConnectionOption('SSL mode Verify identity needs a CA certificate file.');
        }

        return $mode;
    }
}
