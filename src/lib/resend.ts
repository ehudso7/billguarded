import { Resend } from "resend";
import { resendServerEnv } from "@/lib/env";

let resendClient: Resend | undefined;

export function resend() {
  if (!resendClient) {
    resendClient = new Resend(resendServerEnv().RESEND_API_KEY);
  }
  return resendClient;
}
