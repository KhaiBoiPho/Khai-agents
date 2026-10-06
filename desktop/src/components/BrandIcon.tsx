/**
 * Third-party app marks from simple-icons, keyed by simple-icons slug.
 *
 * Only the marks the UI names are imported, so the bundle carries a few dozen
 * paths rather than the whole set. A slug with no entry (simple-icons has
 * dropped Slack, Salesforce and the Microsoft marks at their owners' request)
 * falls back to a generic plug.
 */

import { Plug } from "lucide-react";
import {
  siAirtable,
  siAsana,
  siCalendly,
  siClickup,
  siConfluence,
  siDiagramsdotnet,
  siDiscord,
  siDropbox,
  siFigma,
  siGithub,
  siGmail,
  siGooglecalendar,
  siGoogledocs,
  siGoogledrive,
  siGooglemeet,
  siGooglesheets,
  siHubspot,
  siIntercom,
  siJira,
  siLinear,
  siMailchimp,
  siNotion,
  siPostman,
  siShopify,
  siStripe,
  siSupabase,
  siTelegram,
  siTodoist,
  siTrello,
  siWhatsapp,
  siX,
  siYoutube,
  siZendesk,
  siZoom,
  type SimpleIcon,
} from "simple-icons";

import styles from "./BrandIcon.module.css";

const BRANDS: Record<string, SimpleIcon> = {
  airtable: siAirtable,
  asana: siAsana,
  calendly: siCalendly,
  clickup: siClickup,
  confluence: siConfluence,
  diagramsdotnet: siDiagramsdotnet,
  discord: siDiscord,
  dropbox: siDropbox,
  figma: siFigma,
  github: siGithub,
  gmail: siGmail,
  googlecalendar: siGooglecalendar,
  googledocs: siGoogledocs,
  googledrive: siGoogledrive,
  googlemeet: siGooglemeet,
  googlesheets: siGooglesheets,
  hubspot: siHubspot,
  intercom: siIntercom,
  jira: siJira,
  linear: siLinear,
  mailchimp: siMailchimp,
  notion: siNotion,
  postman: siPostman,
  shopify: siShopify,
  stripe: siStripe,
  supabase: siSupabase,
  telegram: siTelegram,
  todoist: siTodoist,
  trello: siTrello,
  whatsapp: siWhatsapp,
  x: siX,
  youtube: siYoutube,
  zendesk: siZendesk,
  zoom: siZoom,
};

interface BrandIconProps {
  name: string;
  /** Rendered edge in px; the mark fills a 24-unit box. */
  size?: number;
  className?: string;
}

export function BrandIcon({ name, size = 16, className }: BrandIconProps) {
  const icon = BRANDS[name];
  if (!icon) return <Plug size={size - 1} className={className} aria-hidden="true" />;
  // Near-black marks would vanish on the dark theme; draw those in text color.
  const dark = parseInt(icon.hex, 16) < 0x333333;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={[styles.brandIcon, className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <path d={icon.path} fill={dark ? "currentColor" : `#${icon.hex}`} />
    </svg>
  );
}
