import { Extension } from "@tiptap/core";

const blockTypes = ["paragraph", "heading", "blockquote", "codeBlock", "callout", "details"];

export const BlockBackground = Extension.create({
  name: "blockBackground",
  addGlobalAttributes() {
    return [{
      types: blockTypes,
      attributes: {
        backgroundColor: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-background-color"),
          renderHTML: (attributes) => attributes.backgroundColor
            ? { "data-background-color": attributes.backgroundColor, style: `background-color: ${attributes.backgroundColor}` }
            : {},
        },
      },
    }];
  },
});
