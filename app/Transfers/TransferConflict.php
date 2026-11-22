<?php

namespace App\Transfers;

use RuntimeException;

/** Another backup or restore is already active on the same database. */
class TransferConflict extends RuntimeException {}
