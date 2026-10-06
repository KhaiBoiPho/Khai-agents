/*
 * KhaiDocs stand-in for a Docmost Enterprise module. Original code, MIT.
 * Docmost's Enterprise Edition is not included: it is licensed separately
 * and may not be used without a Docmost subscription. Every enterprise
 * feature reports as unavailable.
 */

/** Feature ids the server's entitlements use; none are granted here. */
export const Feature = {
  SSO_CUSTOM: "sso:custom",
  SSO_GOOGLE: "sso:google",
  MFA: "mfa",
  API_KEYS: "api:keys",
  COMMENT_RESOLUTION: "comment:resolution",
  PAGE_PERMISSIONS: "page:permissions",
  AI: "ai",
  CONFLUENCE_IMPORT: "import:confluence",
  DOCX_IMPORT: "import:docx",
  PDF_IMPORT: "import:pdf",
  ATTACHMENT_INDEXING: "attachment:indexing",
  SECURITY_SETTINGS: "security:settings",
  MCP: "mcp",
  SCIM: "scim",
  PAGE_VERIFICATION: "page:verification",
  AUDIT_LOGS: "audit:logs",
  RETENTION: "retention",
  SHARING_CONTROLS: "sharing:controls",
  TEMPLATES: "templates",
  VIEWER_COMMENTS: "comment:viewer",
  PERSONAL_SPACES: "spaces:personal",
  DOCX_EXPORT: "export:docx",
  BASES: "bases",
  OAUTH: "oauth",
  AI_CONTROLS: "ai:controls",
  MCP_CONTROLS: "mcp:controls",
  PUBLIC_SPACE_APPEARANCE: "public-space:appearance",
  SIEM: "siem",
} as const;
