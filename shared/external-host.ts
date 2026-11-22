/**
 * The label on a ticket made or worked outside Paseo (a Claude Code session, any harness with a shell): Paseo's manager,
 * queue ladder, owner relaunch and hand-offs leave such a ticket alone, as nothing of Paseo's works it. Import-free, for
 * the `taro` command under plain Node type stripping as well as the plugin.
 */
export const EXTERNAL_HOST_LABEL = "external-host";

export function isExternalHostTicket(ticket: { labels?: readonly string[] | undefined }): boolean {
  return ticket.labels?.includes(EXTERNAL_HOST_LABEL) === true;
}
