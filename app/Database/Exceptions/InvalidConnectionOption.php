<?php

namespace App\Database\Exceptions;

use InvalidArgumentException;

/** Thrown by drivers for unsafe connection option values. The message is ours and safe to show. */
class InvalidConnectionOption extends InvalidArgumentException {}
