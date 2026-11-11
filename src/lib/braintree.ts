import braintree from "braintree";

// Custom fields that carry the simulated history on each sandbox transaction.
// Each must exist in the sandbox Control Panel (Settings → Processing → Custom Fields) as "Store and pass back".
export const CUSTOM_FIELDS = [
  "sm_invoice_id",
  "sm_subscription_id",
  "sm_billing_date",
  "sm_attempt_at",
  "sm_attempt_no",
  "sm_invoice_amount",
  "sm_route", // trial attempts only (F4): Route A or B
] as const;

const ENV_VARS = ["BRAINTREE_MERCHANT_ID", "BRAINTREE_PUBLIC_KEY", "BRAINTREE_PRIVATE_KEY"] as const;

export class ConnectError extends Error {
  constructor(public title: string, public fix: string) {
    super(title);
  }
}

export function getGateway(): braintree.BraintreeGateway {
  const missing = ENV_VARS.filter((v) => !process.env[v]?.trim());
  if (missing.length) {
    throw new ConnectError(
      `Missing ${missing.join(", ")}`,
      "Copy .env.example to .env, paste the value(s) from Braintree sandbox Control Panel → Settings → API, then restart the app.",
    );
  }
  return new braintree.BraintreeGateway({
    environment: braintree.Environment.Sandbox,
    merchantId: process.env.BRAINTREE_MERCHANT_ID!.trim(),
    publicKey: process.env.BRAINTREE_PUBLIC_KEY!.trim(),
    privateKey: process.env.BRAINTREE_PRIVATE_KEY!.trim(),
  });
}

export const merchantAccountId = () => process.env.BRAINTREE_MERCHANT_ACCOUNT_ID?.trim() || undefined;

// Turns SDK errors into a message that says what is wrong and how to fix it.
export function toConnectError(err: unknown): ConnectError {
  if (err instanceof ConnectError) return err;
  const type = (err as { type?: string })?.type;
  switch (type) {
    case "authenticationError":
      return new ConnectError(
        "Braintree rejected the public key / private key",
        "Check BRAINTREE_PUBLIC_KEY and BRAINTREE_PRIVATE_KEY are copied in full from the same sandbox account (Control Panel → Settings → API).",
      );
    case "authorizationError":
      return new ConnectError(
        "These API keys don't have permission for this action",
        "Use API keys from a sandbox user with the Account Admin role.",
      );
    case "notFoundError":
      return new ConnectError(
        "Braintree couldn't find this merchant ID",
        "Check BRAINTREE_MERCHANT_ID matches the Merchant ID shown under Control Panel → Settings → API for the same keys.",
      );
    case "tooManyRequestsError":
      return new ConnectError("Braintree is rate-limiting requests", "Wait a minute and try again.");
    default:
      return new ConnectError(
        "Couldn't reach the Braintree sandbox",
        `Check your internet connection and try again. (${(err as Error)?.message || String(err)})`,
      );
  }
}

// Fails fast with a clear error if the credentials are wrong. Cheap call with no side effects.
export async function verifyCredentials(gateway: braintree.BraintreeGateway) {
  try {
    await gateway.clientToken.generate({});
  } catch (err) {
    throw toConnectError(err);
  }
}

// Validation errors from a sale, flattened to readable text. Names any custom field that isn't set up.
export function describeValidationErrors(result: { errors?: { deepErrors(): { attribute: string; message: string }[] } }) {
  const errs = result.errors?.deepErrors() ?? [];
  return errs.map((e) => `${e.attribute}: ${e.message}`).join("; ");
}
