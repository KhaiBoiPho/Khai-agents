import { useEffect, useState, type ReactNode } from "react";

import { AccountContext } from "./AccountContext";
import { accountsEnabled, currentAccount, type Account } from "./accountApi";
import { SignIn } from "./SignIn";

type GateState =
  | { kind: "checking" }
  | { kind: "open" } // a server without accounts
  | { kind: "signedOut" }
  | { kind: "signedIn"; account: Account };

/**
 * On the hosted gateway, shows sign-in until there is an account and then
 * provides it to the app. On a server without accounts it renders the app
 * directly, as before.
 */
export function AccountGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: "checking" });

  useEffect(() => {
    let live = true;
    void (async () => {
      const enabled = await accountsEnabled();
      if (!live) return;
      if (!enabled) return setState({ kind: "open" });
      const account = await currentAccount().catch(() => null);
      if (!live) return;
      setState(account ? { kind: "signedIn", account } : { kind: "signedOut" });
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === "checking") return null;
  if (state.kind === "open") return <>{children}</>;
  if (state.kind === "signedOut")
    return (
      <SignIn onSignedIn={(account) => setState({ kind: "signedIn", account })} />
    );
  return (
    <AccountContext.Provider value={state.account}>{children}</AccountContext.Provider>
  );
}
