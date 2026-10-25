import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { Header } from "./components/Header";
import { SavedToaster } from "./ui";

/**
 * App shell: top bar, then the routed feature. Features own their whole page body (bands are
 * full-bleed, content widths differ per screen), so there is no padded <main> wrapper here.
 */
export function Layout() {
  return (
    <div className="min-h-screen bg-canvas text-text">
      <Header />
      <main>
        <Suspense fallback={<p className="m-0 px-7 py-10 text-text3">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
      <SavedToaster />
    </div>
  );
}
