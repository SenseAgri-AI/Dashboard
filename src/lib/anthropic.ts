import Anthropic from "@anthropic-ai/sdk";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

// Server-side Anthropic client for the Flock Vet assistant. The API key lives in AWS
// SSM Parameter Store (SecureString) — same pattern as the InfluxDB token — and is
// cached for an hour. The key never reaches the browser. Swapping to Claude on Bedrock
// later is a change confined to this file (no call-site edits).

/** Model used by the assistant. One constant → swap to claude-sonnet-5 if cost matters. */
export const AGENT_MODEL = "claude-opus-4-8";

/** Thrown when the Anthropic key isn't provisioned in SSM yet. Routes map this to 503. */
export class AssistantNotConfiguredError extends Error {
  constructor(message = "The Flock Vet assistant is not configured yet.") {
    super(message);
    this.name = "AssistantNotConfiguredError";
  }
}

const TTL_MS = 60 * 60 * 1000;
let cachedKey: string | null = null;
let keyFetchedAt = 0;
let cachedClient: Anthropic | null = null;
let cachedClientKey: string | null = null;

async function getAnthropicKey(): Promise<string> {
  if (cachedKey && Date.now() - keyFetchedAt < TTL_MS) return cachedKey;

  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "af-south-1" });
  let value: string | undefined;
  try {
    const res = await ssm.send(
      new GetParameterCommand({ Name: "/senseagri/dev/anthropic/api-key", WithDecryption: true })
    );
    value = res.Parameter?.Value;
  } catch (err) {
    // No parameter yet → "not configured" (friendly 503). Any other SSM/IAM failure is a
    // real error and should surface as a 500.
    if (err && typeof err === "object" && (err as { name?: string }).name === "ParameterNotFound") {
      throw new AssistantNotConfiguredError();
    }
    throw err;
  }
  if (!value) throw new AssistantNotConfiguredError();

  cachedKey = value;
  keyFetchedAt = Date.now();
  return value;
}

/** Cached Anthropic client built from the SSM-held key. Throws AssistantNotConfiguredError
 *  until the key exists. */
export async function getAnthropicClient(): Promise<Anthropic> {
  const key = await getAnthropicKey();
  if (cachedClient && cachedClientKey === key) return cachedClient;
  cachedClient = new Anthropic({ apiKey: key });
  cachedClientKey = key;
  return cachedClient;
}
