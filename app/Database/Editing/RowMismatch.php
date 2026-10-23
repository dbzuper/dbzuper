<?php

namespace App\Database\Editing;

use Illuminate\Contracts\Debug\ShouldntReport;
use Illuminate\Http\JsonResponse;
use RuntimeException;

/** A change-set statement matched no row (`changed`) or several (`multiple`); the commit was rolled back (spec §5). */
final class RowMismatch extends RuntimeException implements ShouldntReport
{
    /** @param 'changed'|'multiple' $reason */
    public function __construct(public readonly int $index, public readonly string $reason)
    {
        parent::__construct($reason === 'changed' ? 'row changed since you loaded it' : 'matched more than one row');
    }

    public static function forCount(int $index, int $affected): self
    {
        return new self($index, $affected === 0 ? 'changed' : 'multiple');
    }

    public function render(): JsonResponse
    {
        return response()->json(['error' => [
            'kind' => 'row_mismatch', 'message' => $this->getMessage(), 'index' => $this->index, 'reason' => $this->reason,
        ]], 409);
    }
}
