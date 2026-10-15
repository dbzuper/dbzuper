<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class HistoryPageController extends Controller
{
    public function __invoke(Request $request): Response
    {
        return Inertia::render('history/index', [
            'connections' => $request->user()->connections()->orderBy('name')->get(['id', 'name']),
        ]);
    }
}
