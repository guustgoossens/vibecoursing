import type { ReactNode } from 'react';

export function ChatLayout({
  header,
  sidebar,
  main,
}: {
  header: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-slate-200 bg-background dark:border-slate-800">{header}</header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-muted/40 p-4 dark:border-slate-800 lg:block">
          <div className="flex h-full flex-col gap-4">{sidebar}</div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-background">{main}</main>
      </div>
    </div>
  );
}
