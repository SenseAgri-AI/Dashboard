import { isSuperadmin } from "@/lib/admin";
import AdminClient from "@/components/AdminClient";

export default async function AdminPage() {
  if (!(await isSuperadmin())) {
    return (
      <main className="sa-main">
        <div style={{ padding: 40, textAlign: "center", color: "var(--danger)", fontWeight: 600 }}>
          Not authorized — superadmin access required.
        </div>
      </main>
    );
  }
  return <AdminClient />;
}
