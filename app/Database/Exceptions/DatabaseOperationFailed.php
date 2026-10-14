<?php

namespace App\Database\Exceptions;

use App\Database\Errors\DbError;
use Illuminate\Http\JsonResponse;
use RuntimeException;

class DatabaseOperationFailed extends RuntimeException
{
    public function __construct(public readonly DbError $error)
    {
        parent::__construct($error->message);
    }

    public function render(): JsonResponse
    {
        return response()->json(['error' => $this->error->toArray()], 422);
    }
}
