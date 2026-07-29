export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getFreshUser } from "@/app/actions/auth";
import Gstr1Client from "./Gstr1Client";

export default async function Gstr1Page() {
  const user = await getFreshUser();
  if (!user) redirect("/auth/signin");
  return <Gstr1Client />;
}
