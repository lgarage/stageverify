const VALIDATE_PICKUP_TOKEN_URL =
  "https://us-central1-stageverify-db.cloudfunctions.net/validatePickupToken";

const VALIDATE_TIMEOUT_MS = 15_000;

type CallableBody = {
  result?: { valid: boolean; jobId: string; expiresAt: string };
  error?: { message?: string };
};

export class PickupTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PickupTokenError";
  }
}

export async function validatePickupTokenClient(token: string): Promise<{
  jobId: string;
  expiresAt: string;
}> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const response = await fetch(VALIDATE_PICKUP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { token } }),
      signal: controller.signal,
    });

    let body: CallableBody;
    try {
      body = (await response.json()) as CallableBody;
    } catch {
      throw new PickupTokenError(
        "Unable to open pickup link. Ask dispatch for a new link.",
      );
    }

    if (body.error?.message) {
      throw new PickupTokenError(body.error.message);
    }
    if (!body.result?.valid || !body.result.jobId) {
      throw new PickupTokenError(
        "Invalid or expired pickup link. Ask dispatch for a new link.",
      );
    }

    return {
      jobId: body.result.jobId,
      expiresAt: body.result.expiresAt,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new PickupTokenError(
        "Pickup link verify timed out. Try again or ask dispatch for a new link.",
      );
    }
    if (err instanceof PickupTokenError) throw err;
    if (err instanceof Error) {
      throw new PickupTokenError(err.message);
    }
    throw new PickupTokenError(
      "Invalid or expired pickup link. Ask dispatch for a new link.",
    );
  } finally {
    window.clearTimeout(timer);
  }
}
