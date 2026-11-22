<?php

namespace App\Transfers\Import;

use RuntimeException;

/** A dump file can't be restored into the open database; the message is shown to the user as is. */
final class RestoreRefused extends RuntimeException {}
