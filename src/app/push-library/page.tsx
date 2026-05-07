import { redirect } from "next/navigation";

export default function PushLibraryRedirect() {
  redirect("/messages");
}
