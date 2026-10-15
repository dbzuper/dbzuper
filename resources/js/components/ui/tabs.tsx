import * as TabsPrimitive from '@radix-ui/react-tabs';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
    return <TabsPrimitive.Root className={cn('flex flex-col', className)} {...props} />;
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
    return <TabsPrimitive.List className={cn('inline-flex items-center gap-1 border-b px-3', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
    return (
        <TabsPrimitive.Trigger
            className={cn(
                '-mb-px border-b-2 border-transparent px-2 py-2 text-xs font-medium text-muted-foreground transition-colors motion-reduce:transition-none hover:text-foreground data-[state=active]:border-[var(--universe-accent)] data-[state=active]:text-foreground',
                className,
            )}
            {...props}
        />
    );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
    return <TabsPrimitive.Content className={cn('min-h-0 flex-1 overflow-auto', className)} {...props} />;
}
