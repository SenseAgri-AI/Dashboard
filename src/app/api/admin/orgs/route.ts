import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { requireSuperadmin, NotSuperadminError } from "@/lib/admin";
import { putFarmConfig, listConfiguredFarmSlugs, type FarmConfig } from "@/lib/farms";

export const dynamic = "force-dynamic";

const err = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET() {
  try {
    await requireSuperadmin();
  } catch (e) {
    if (e instanceof NotSuperadminError) return err(403, e.message);
    return err(500, "Failed");
  }
  const client = await clerkClient();
  const [orgs, configured] = await Promise.all([
    client.organizations.getOrganizationList({ limit: 100 }),
    listConfiguredFarmSlugs(),
  ]);
  const configuredSet = new Set(configured);
  return NextResponse.json({
    orgs: orgs.data.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      members: o.membersCount,
      hasConfig: o.slug ? configuredSet.has(o.slug) : false,
    })),
  });
}

interface OnboardBody {
  orgName: string;
  slug: string;
  adminEmail: string;
  farmConfig: FarmConfig;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  try {
    await requireSuperadmin();
  } catch (e) {
    if (e instanceof NotSuperadminError) return err(403, e.message);
    return err(500, "Failed");
  }
  if (!userId) return err(401, "Not authenticated");

  let body: OnboardBody;
  try {
    body = (await request.json()) as OnboardBody;
  } catch {
    return err(400, "Invalid JSON body");
  }

  const { orgName, slug, adminEmail, farmConfig } = body;
  if (!orgName?.trim() || !slug?.trim()) return err(400, "Organization name and slug are required");
  if (!/^[a-z0-9-]+$/.test(slug)) return err(400, "Slug must be lowercase letters, numbers, and hyphens");
  if (!farmConfig?.farmId || !farmConfig?.spreadsheetId) {
    return err(400, "farmConfig must include at least farmId and spreadsheetId");
  }

  const client = await clerkClient();

  // 1. Create the Clerk org — createdBy makes the superadmin its first admin,
  //    so you always have admin access to every org you onboard.
  let org;
  try {
    org = await client.organizations.createOrganization({ name: orgName.trim(), slug: slug.trim(), createdBy: userId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create organization";
    return err(400, `Clerk: ${msg}`);
  }

  // 2. Write the farm config to SSM so the org resolves to real data.
  try {
    await putFarmConfig(slug.trim(), farmConfig);
  } catch (e) {
    return err(500, `Org created but SSM config write failed: ${e instanceof Error ? e.message : "error"}`);
  }

  // 3. Invite the client's admin (optional).
  let invited = false;
  if (adminEmail?.trim()) {
    try {
      await client.organizations.createOrganizationInvitation({
        organizationId: org.id,
        inviterUserId: userId,
        emailAddress: adminEmail.trim(),
        role: "org:admin",
      });
      invited = true;
    } catch {
      // Non-fatal: org + config exist; invite can be retried from Clerk.
    }
  }

  return NextResponse.json({ org: { id: org.id, name: org.name, slug: org.slug }, invited });
}
