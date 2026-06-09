import { Outlet } from "@tanstack/react-router";
import { Sidebar } from "./Sidebar";

export function Layout() {
  return (
    <div id="shell">
      <Sidebar />
      <main id="content">
        <Outlet />
      </main>
    </div>
  );
}
