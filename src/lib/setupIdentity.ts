export const SETUP_RECEIPT_KEY = "mosaic-setup-receipt-v1";
export type SetupReceipt = { identity: string; disposition: "completed" | "skipped" };

// The old dismissal flag cannot prove that this app identity completed setup.
// A version change alone is irrelevant: signed updates keep the same identity.
export function hasCurrentSetup(identity: string, stored: string | null): boolean {
  if (!identity || !stored) return false;
  try {
    const receipt = JSON.parse(stored) as SetupReceipt;
    return receipt.identity === identity && (receipt.disposition === "completed" || receipt.disposition === "skipped");
  } catch { return false; }
}
