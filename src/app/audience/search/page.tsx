import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { UserSearch } from "@/components/users/user-search";
import { getAuth } from "@/lib/auth";

export default async function SearchUsersPage() {
  // The user-search/profile APIs are admin-only (donor PII + giving amounts), so
  // gate the page to match — non-admins would otherwise hit a page whose calls 403.
  const { isAdmin } = await getAuth();
  if (!isAdmin) redirect("/");

  return (
    <>
      <Header title="Search Users" description="Look up an individual user by external ID, Braze ID, or email." />
      <div className="flex-1 p-6">
        <UserSearch />
      </div>
    </>
  );
}
