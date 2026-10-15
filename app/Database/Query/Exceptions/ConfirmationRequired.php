<?php

namespace App\Database\Query\Exceptions;

use App\Database\Sql\Classification;
use Illuminate\Http\JsonResponse;
use RuntimeException;

class ConfirmationRequired extends RuntimeException
{
    /** @param 'confirm'|'typed' $mode */
    public function __construct(public readonly int $index, public readonly string $mode, public readonly Classification $classification)
    {
        parent::__construct('Confirmation required.');
    }

    public function render(): JsonResponse
    {
        return response()->json(['confirmation' => ['statement_index' => $this->index, 'mode' => $this->mode, ...$this->classification->toArray()]], 409);
    }
}
