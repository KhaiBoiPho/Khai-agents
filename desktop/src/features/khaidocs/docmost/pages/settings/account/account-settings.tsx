import AccountNameForm from "@/features/user/components/account-name-form";
import ChangeEmail from "@/features/user/components/change-email";
import ChangePassword from "@/features/user/components/change-password";
import { Divider } from "@mantine/core";
import AccountAvatar from "@/features/user/components/account-avatar";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { useTranslation } from "react-i18next";
import { AccountMfaSection } from "@/features/user/components/account-mfa-section";
import SessionList from "@/features/session/components/session-list";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import { SINGLE_USER } from "@/lib/khaidocs-mode.ts"; // KhaiDocs

export default function AccountSettings() {
  const { t } = useTranslation();

  return (
    <>
      <DocumentTitle title={t("My Profile")} />
      <SettingsTitle title={t("My Profile")} />

      <AccountAvatar />

      <AccountNameForm />

      {/* KhaiDocs: sign-in is the Khai account, so the login email,
          password, MFA and sessions are not the owner's to manage here. */}
      {!SINGLE_USER && (
        <>
        <Divider my="lg" />

        <ChangeEmail />

        <Divider my="lg" />

        <ChangePassword />

        <Divider my="lg" />

        <AccountMfaSection />

        <Divider my="lg" />

        <SessionList />
        </>
      )}
    </>
  );
}
