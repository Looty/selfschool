import { useParams } from "react-router-dom";

/** Stand-in body for a screen that is not built yet. Replace the feature's index.tsx, not this. */
export function Placeholder({ title, note }: { title: string; note?: string }) {
  const params = useParams();
  return (
    <div className="mx-auto max-w-[880px] px-7 py-8">
      <h1 className="m-0 text-[30px] font-semibold leading-tight tracking-tight">{title}</h1>
      <p className="mt-2 text-text2">{note ?? "Placeholder: this screen is built in a later session."}</p>
      {Object.keys(params).length > 0 ? (
        <pre className="mt-4 rounded-control border border-border bg-surface p-3 font-mono text-xs text-text2">{JSON.stringify(params, null, 2)}</pre>
      ) : null}
    </div>
  );
}
