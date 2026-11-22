<?php

namespace App\Transfers;

use RuntimeException;

/** Thrown inside a running transfer when the user asked to stop it. */
class TransferCancelled extends RuntimeException {}
