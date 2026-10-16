export interface ConfirmActionOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
  confirmLabel?: string;
  cancelLabel?: string;
}

type ConfirmHandler = (
  message: string,
  options: ConfirmActionOptions,
) => Promise<boolean>;
let confirmHandler: ConfirmHandler = async (message) => window.confirm(message);
export function setConfirmHandler(handler: ConfirmHandler): void {
  confirmHandler = handler;
}

/**
 * Ask for explicit user confirmation on every supported frontend surface.
 *
 * Always asynchronous, so a custom in-app dialog can replace the browser's
 * one without callers ever treating the returned Promise as a truthy
 * confirmation.
 */
export async function confirmAction(
  message: string,
  options: ConfirmActionOptions = {},
): Promise<boolean> {
  return confirmHandler(message, options);
}
