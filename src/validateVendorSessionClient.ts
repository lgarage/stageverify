const VALIDATE_VENDOR_SESSION_URL =
  "https://us-central1-stageverify-db.cloudfunctions.net/validateVendorSession";

const VALIDATE_TIMEOUT_MS = 15_000;

type CallableBody = {
  result?: { valid: boolean };
  error?: { message?: string };
};

export async function validateVendorSessionClient(input: {
  sessionToken: string;
  deliveryId: string;
}): Promise<void> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const response = await fetch(VALIDATE_VENDOR_SESSION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: input }),
      signal: controller.signal,
    });

    let body: CallableBody;
    try {
      body = (await response.json()) as CallableBody;
    } catch {
      throw new Error("Unable to verify session. Enter your PIN again.");
    }

    if (body.error?.message) {
      throw new Error(body.error.message);
    }
    if (!body.result?.valid) {
      throw new Error("Session expired. Enter your PIN again.");
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Session verify timed out. Enter your PIN again.");
    }
    if (err instanceof Error) throw err;
    throw new Error("Session expired. Enter your PIN again.");
  } finally {
    window.clearTimeout(timer);
  }
}
