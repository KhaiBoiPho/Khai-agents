/**
 * Sign-in and registration for the hosted web app.
 *
 * Styling and the entrance animation follow Bedimcode's "Responsive login
 * form with GSAP" (github.com/bedimcode/responsive-login-form-with-gsap; the
 * repository carries no license file), re-laid-out around a 16:9 artwork:
 * beside the form on wide screens, a banner above it on medium ones. The GSAP
 * timeline is re-created with the Web Animations API, and icons and the Syne
 * font are bundled locally, because the app's Content Security Policy only
 * loads same-origin resources.
 */

import { IdCard, Lock, LockKeyhole, SendHorizontal, User } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import loginArt from "../../assets/login/kame-house.jpg";
import { AccountError, register, signIn, type Account } from "./accountApi";
import "./syne.css";
import styles from "./SignIn.module.css";

type Mode = "signIn" | "register";

const POWER3_OUT = "cubic-bezier(0.215, 0.61, 0.355, 1)";
const POWER2_OUT = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";

/** The original GSAP timeline: drop in, grow tall, grow wide, then the
 *  title, the form rows one by one, and the artwork. */
function useEntrance(
  content: React.RefObject<HTMLDivElement | null>,
  image: React.RefObject<HTMLImageElement | null>,
) {
  useEffect(() => {
    const card = content.current;
    if (!card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animations: Animation[] = [];
    animations.push(
      card.animate(
        [
          { transform: "translateY(-800px) scale(0.2, 0.5)", opacity: 0 },
          { transform: "translateY(0) scale(0.2, 0.5)", opacity: 1, offset: 0.62 },
          { transform: "translateY(0) scale(0.2, 1)", opacity: 1, offset: 0.8 },
          { transform: "translateY(0) scale(1, 1)", opacity: 1 },
        ],
        { duration: 2400, easing: POWER3_OUT, fill: "backwards" },
      ),
    );
    const rise = (element: Element, delay: number) =>
      animations.push(
        element.animate(
          [
            { transform: "translateY(-60px)", opacity: 0 },
            { transform: "translateY(0)", opacity: 1 },
          ],
          { duration: 1200, delay, easing: POWER2_OUT, fill: "backwards" },
        ),
      );
    const title = card.querySelector(`.${styles.title}`);
    if (title) rise(title, 2500);
    card
      .querySelectorAll(`.${styles.form} > *`)
      .forEach((row, index) => rise(row, 2700 + index * 200));
    const art = image.current;
    if (art) {
      animations.push(
        art.animate(
          [
            { transform: "translateX(100px)", opacity: 0 },
            { transform: "translateX(-6px)", opacity: 1, offset: 0.55 },
            { transform: "translateX(3px)", opacity: 1, offset: 0.75 },
            { transform: "translateX(0)", opacity: 1 },
          ],
          { duration: 1200, delay: 3200, easing: "ease-out", fill: "backwards" },
        ),
        // The slow "breathing" zoom of the artwork.
        art.animate([{ scale: "1" }, { scale: "1.08" }], {
          duration: 5000,
          delay: 2400,
          iterations: Infinity,
          direction: "alternate",
          easing: "ease-in-out",
          composite: "add",
        }),
      );
    }
    return () => animations.forEach((animation) => animation.cancel());
  }, [content, image]);
}

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.38l4.01-3.1Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l4.01 3.1C6.23 6.88 8.88 4.77 12 4.77Z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.02c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.62-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .3Z"
      />
    </svg>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.box}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      {children}
      <span className={styles.label}>{label}</span>
    </div>
  );
}

export function SignIn({ onSignedIn }: { onSignedIn(account: Account): void }) {
  const { t } = useTranslation();
  const content = useRef<HTMLDivElement | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<Mode>("signIn");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEntrance(content, image);

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
    setConfirm("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === "register" && password !== confirm) {
      setError(t("account.passwordMismatch", "The passwords do not match."));
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        const result = await register(username, password, displayName);
        if (result.pendingApproval) {
          switchTo("signIn");
          setNotice(
            t(
              "account.pendingNotice",
              "Registration received. You can sign in once an administrator approves your account.",
            ),
          );
          return;
        }
      }
      onSignedIn(await signIn(username, password));
    } catch (caught) {
      setError(
        caught instanceof AccountError
          ? caught.message
          : t("account.unreachable", "The server could not be reached."),
      );
    } finally {
      setBusy(false);
    }
  };

  const registering = mode === "register";
  return (
    <section className={styles.login}>
      <div className={styles.content} ref={content}>
        <div>
          <h2 className={styles.title}>
            {registering ? t("account.join", "Join") : t("account.welcomeTo", "Welcome to")}{" "}
            <span className={styles.brand}>Khai-Agents</span>
          </h2>

          <form className={styles.form} onSubmit={submit} noValidate>
            {notice || error ? (
              <p
                className={error ? styles.error : styles.notice}
                role={error ? "alert" : "status"}
              >
                {error ?? notice}
              </p>
            ) : null}

            <div className={styles.group}>
              <Field icon={<User size={22} />} label={t("account.username", "Username")}>
                <input
                  className={styles.input}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  placeholder=" "
                  aria-label={t("account.username", "Username")}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>
              {registering ? (
                <Field
                  icon={<IdCard size={22} />}
                  label={t("account.displayName", "Display name")}
                >
                  <input
                    className={styles.input}
                    autoComplete="name"
                    placeholder=" "
                    aria-label={t("account.displayName", "Display name")}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </Field>
              ) : null}
              <Field icon={<Lock size={22} />} label={t("account.password", "Password")}>
                <input
                  className={styles.input}
                  type="password"
                  autoComplete={registering ? "new-password" : "current-password"}
                  required
                  placeholder=" "
                  aria-label={t("account.password", "Password")}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              {registering ? (
                <Field
                  icon={<LockKeyhole size={22} />}
                  label={t("account.confirmPassword", "Confirm password")}
                >
                  <input
                    className={styles.input}
                    type="password"
                    autoComplete="new-password"
                    required
                    placeholder=" "
                    aria-label={t("account.confirmPassword", "Confirm password")}
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </Field>
              ) : null}
            </div>

            {registering ? (
              <p className={styles.hint}>
                {t(
                  "account.registerHint",
                  "At least 10 characters. An administrator approves new accounts.",
                )}
              </p>
            ) : (
              <button
                type="button"
                className={styles.forgot}
                onClick={() =>
                  setNotice(
                    t(
                      "account.forgotNotice",
                      "Ask an administrator to reset your password.",
                    ),
                  )
                }
              >
                {t("account.forgot", "Forgot Password?")}
              </button>
            )}

            <button type="submit" className={styles.button} disabled={busy}>
              {registering
                ? t("account.register", "Create account")
                : t("account.signIn", "Log In")}
              <SendHorizontal size={22} aria-hidden="true" />
            </button>

            <div className={styles.divider} role="separator">
              <span>{t("account.orContinue", "or continue with")}</span>
            </div>
            {/* Mock: OAuth sign-in is not wired up yet. */}
            <div className={styles.providers}>
              {(["Google", "GitHub"] as const).map((provider) => (
                <button
                  key={provider}
                  type="button"
                  className={styles.provider}
                  aria-disabled="true"
                  title={t("account.comingSoon", "Coming soon")}
                  onClick={() =>
                    setNotice(
                      t("account.providerSoon", "Signing in with {{provider}} is coming soon.", {
                        provider,
                      }),
                    )
                  }
                >
                  {provider === "Google" ? <GoogleMark /> : <GitHubMark />}
                  {provider}
                </button>
              ))}
            </div>

            <p className={styles.sign}>
              {registering
                ? t("account.haveAccount", "Already have an account?")
                : t("account.needAccount", "Don't have an account?")}{" "}
              <button type="button" onClick={() => switchTo(registering ? "signIn" : "register")}>
                {registering ? t("account.signIn", "Log In") : t("account.signUp", "Sign Up")}
              </button>
            </p>
          </form>
        </div>

        <div className={styles.image}>
          <img src={loginArt} alt="" className={styles.img} ref={image} />
        </div>
      </div>
    </section>
  );
}
