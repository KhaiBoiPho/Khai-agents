import {
  Badge,
  createTheme,
  CSSVariablesResolver,
  Portal,
  Tabs,
  Tooltip,
  v8CssVariablesResolver,
} from "@mantine/core";
// KhaiDocs: the host's tokens, font and monochrome signal (MIT, ../notion/theme.ts).
import { hostCssVariables, hostThemeOverride } from "../notion/theme";

export const theme = createTheme({
  // KhaiDocs: host palette, font, radii and shadows.
  ...hostThemeOverride,
  components: {
    // KhaiDocs: portal into the KhaiDocs root rather than <body>, so modals,
    // menus and toasts keep the Mantine variables and colour scheme scoped
    // there (and stay inside the KhaiDocs area).
    Portal: Portal.extend({
      defaultProps: { target: ".khaidocs-root" },
    }),
    Tooltip: Tooltip.extend({
      defaultProps: {
        events: { hover: true, focus: true, touch: false },
      },
    }),
    // Size badges to their content; fit-content collapses inside table cells.
    Badge: Badge.extend({
      styles: (_theme, props) => ({
        root:
          props.fullWidth || props.circle
            ? {}
            : { width: "max-content", maxWidth: "100%" },
      }),
    }),
    Tabs: Tabs.extend({
      vars: (theme, props) => ({
        root: {
          ...(props.color === "dark" && {
            "--tabs-color": "var(--mantine-color-dark-default)",
          }),
        },
      }),
    }),
  },
  /***
  components: {
    ActionIcon: ActionIcon.extend({
      vars: (_theme, props) => {
        return {
          root: {
            ...(props.variant === "subtle" &&
              props.color === "dark" && {
                "--ai-color": "var(--mantine-color-default-color)",
                "--ai-hover": "var(--mantine-color-default-hover)",
              }),
          },
        };
      },
    }),
  },
  ***/
});

export const mantineCssResolver: CSSVariablesResolver = (theme) => {
  const base = v8CssVariablesResolver(theme);
  return {
    variables: {
      ...base.variables,
      ...hostCssVariables,
      "--input-error-size": theme.fontSizes.sm,
    },
    // The scheme blocks outrank `variables`, so the host mapping repeats here.
    light: { ...base.light, ...hostCssVariables },
    dark: { ...base.dark, ...hostCssVariables },
  };
};
