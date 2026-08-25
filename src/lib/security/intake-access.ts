import { cookies } from "next/headers";
import {
  intakeCookieName,
  verifyIntakeCookie,
} from "@/lib/security/intake-cookie";

export async function hasIntakeAccess(requestId: string) {
  const cookieStore = await cookies();
  const access = verifyIntakeCookie(cookieStore.get(intakeCookieName)?.value);
  return access?.requestId === requestId;
}
