import { Wordmark } from "./Wordmark";

export function AuthCard({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <div className="hazard" />
      <main className="mx-auto flex max-w-md flex-col px-5 pt-12 pb-16">
        <Wordmark />
        <h1 className="sign mt-10 text-4xl font-bold leading-tight">{title}</h1>
        {intro && <div className="mt-3 text-slush">{intro}</div>}
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
