import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countUnreadNotifications } from "@/lib/notifications/queries";
import { countPendingWChecks } from "@/lib/wchecks/queries";
import { listStaffPresenceRoster } from "@/lib/presence/queries";
import { Sidebar } from "@/components/Sidebar";
import { logoutAction } from "./logout-action";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const [unreadCount, wcheckWaitingCount, staffPresenceRoster] = await Promise.all([
    countUnreadNotifications(supabase, staff.id),
    countPendingWChecks(supabase),
    listStaffPresenceRoster(supabase),
  ]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
      <Sidebar
        role={staff.role}
        unreadCount={unreadCount}
        wcheckWaitingCount={wcheckWaitingCount}
        staffPresenceRoster={staffPresenceRoster}
        currentStaffId={staff.id}
        currentStaffName={`${staff.last_name} ${staff.first_name}`}
        onLogout={logoutAction}
      />
      <main className="min-w-0">{children}</main>
    </div>
  );
}
