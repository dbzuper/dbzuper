<?php

namespace App\Database\Query\Exceptions;

use App\Database\Sql\Classification;
use Illuminate\Http\JsonResponse;
use RuntimeException;

class ReadOnlyStatement extends RuntimeException
{
    public function __construct(public readonly int $index, public readonly Classification $classification)
    {
        parent::__construct('Read-only connection.');
    }

    public function render(): JsonResponse
    {
        $keyword = $this->classification->keyword !== '' ? $this->classification->keyword : 'This';

        return response()->json(['error' => [
            'kind' => 'readonly',
            'message' => "This connection is read-only. {$keyword} statements are not allowed.",
            'sqlstate' => null,
            'reason' => 'readonly_connection',
            'statement_index' => $this->index,
        ]], 422);
    }
}
