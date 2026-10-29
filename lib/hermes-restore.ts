/** The snapshot and region used for Hermes workspaces. */
export const HERMES_SNAPSHOT_NAME = "hermes-openrouter";
export const HERMES_REGION = "ap-southeast-1";

export function hermesRestoreArgs(snapshotName = HERMES_SNAPSHOT_NAME) {
  return ["ls-restore", "--snapshot-name", snapshotName, "--region", HERMES_REGION];
}

/**
 * ls-restore emits a hostname before creating the instance and repeats it in
 * the completion summary. Do not mistake its deploy UUID or IP for the
 * Lightsail instance name: that name is required to track and destroy it.
 */
export function hermesRestoreHostname(output: string): string | null {
  const match = output.match(/^\s*(?:Hostname|Instance creation started):\s*(openclaw-[a-zA-Z0-9-]+)\s*$/m);
  return match?.[1] ?? null;
}
