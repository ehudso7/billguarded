import Stripe from "stripe";
import { stripeServerEnv } from "@/lib/env";

let stripeClient: Stripe | undefined;

export function stripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(stripeServerEnv().STRIPE_SECRET_KEY, {
      apiVersion: "2026-07-29.dahlia",
      appInfo: {
        name: "Reqovr",
        version: "0.1.0",
      },
    });
  }

  return stripeClient;
}
