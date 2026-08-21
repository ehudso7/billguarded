import Stripe from "stripe";
import { serverEnv } from "@/lib/env";

let stripeClient: Stripe | undefined;

export function stripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(serverEnv().STRIPE_SECRET_KEY, {
      apiVersion: "2026-06-24.dahlia",
      appInfo: {
        name: "Reqovr",
        version: "0.1.0",
      },
    });
  }

  return stripeClient;
}
