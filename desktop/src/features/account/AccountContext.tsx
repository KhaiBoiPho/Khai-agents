import { createContext, useContext } from "react";

import type { Account } from "./accountApi";

/**
 * The signed-in account in the hosted web app; null in the desktop app and
 * the single-user web service, which have no accounts.
 */
export const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account | null {
  return useContext(AccountContext);
}
