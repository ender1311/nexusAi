import { Header } from "@/components/layout/header";
import { UserSearch } from "@/components/users/user-search";

export default function SearchUsersPage() {
  return (
    <>
      <Header title="Search Users" description="Look up an individual user by external ID, Braze ID, or email." />
      <div className="flex-1 p-6">
        <UserSearch />
      </div>
    </>
  );
}
