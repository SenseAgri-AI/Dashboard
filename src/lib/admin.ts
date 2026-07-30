import { currentUser } from "@clerk/nextjs/server";

export class NotSuperadminError extends Error {
  constructor() {
    super("Superadmin access required");
    this.name = "NotSuperadminError";
  }
}

/** True if the signed-in user has role=superadmin in Clerk public metadata. */
export async function isSuperadmin(): Promise<boolean> {
  const user = await currentUser();
  return user?.publicMetadata?.role === "superadmin";
}

export async function requireSuperadmin(): Promise<void> {
  if (!(await isSuperadmin())) throw new NotSuperadminError();
}
