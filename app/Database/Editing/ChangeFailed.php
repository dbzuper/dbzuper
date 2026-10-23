<?php

namespace App\Database\Editing;

use App\Database\Errors\DbError;
use Illuminate\Contracts\Debug\ShouldntReport;
use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * The database refused a change set; it was rolled back. `index` is the request index of the change whose statement
 * failed, or null when nothing was running (opening the transaction or committing it).
 */
final class ChangeFailed extends RuntimeException implements ShouldntReport
{
    public function __construct(public readonly ?int $index, public readonly DbError $error)
    {
        parent::__construct($error->message);
    }

    public function render(): JsonResponse
    {
        return response()->json(['error' => $this->error->toArray(), 'index' => $this->index], 422);
    }
}
