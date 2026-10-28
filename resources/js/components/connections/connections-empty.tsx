import { Link, router } from '@inertiajs/react';
import { Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { StarMap } from '@/components/connections/star-map';
import { RadarSweep } from '@/components/radar';
import { Button } from '@/components/ui/button';

const EMPTY_SEED = 5;

/** Shown instead of the summary, tools and grid when there are no connections yet. */
export function ConnectionsEmpty({
    canTryDemo = false,
}: {
    canTryDemo?: boolean;
}) {
    const [building, setBuilding] = useState(false);

    const tryDemo = () =>
        router.post(
            '/connections/demo',
            {},
            {
                onStart: () => setBuilding(true),
                onFinish: () => setBuilding(false),
            },
        );

    return (
        <section className="grid flex-1 place-items-center p-10 text-center">
            <div>
                <StarMap
                    seed={EMPTY_SEED}
                    star={null}
                    color="var(--primary)"
                    className="mx-auto mb-2 h-[200px] w-full max-w-[340px]"
                />
                <h2 className="mb-1.5 text-[22px] font-semibold tracking-tight">
                    Connect your first database
                </h2>
                <p className="mx-auto mb-[18px] max-w-[420px] text-muted-foreground">
                    Point DBZuper at MySQL, MariaDB, PostgreSQL or a SQLite
                    file. It maps the schema into a universe you can fly
                    through, browse and edit.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                    <Button asChild>
                        <Link href="/connections/create">
                            <Plus aria-hidden />
                            New connection
                        </Link>
                    </Button>
                    {canTryDemo && (
                        <Button
                            variant="outline"
                            onClick={tryDemo}
                            disabled={building}
                        >
                            {building ? (
                                <RadarSweep className="size-4" />
                            ) : (
                                <Sparkles aria-hidden />
                            )}
                            Try it with demo data
                        </Button>
                    )}
                </div>
                {canTryDemo && (
                    <p className="mx-auto mt-3 max-w-[420px] text-xs text-muted-foreground">
                        A small online shop in SQLite (users, products and
                        orders), added as a connection you can delete any time.
                    </p>
                )}
            </div>
        </section>
    );
}
