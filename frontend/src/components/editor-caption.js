import { Node } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { VueNodeViewRenderer } from "@tiptap/vue-3";

import CaptionView from "./editor-caption-view.vue";

// Caption of a figure, a table or a code block: <legend label="Figure" alt="Text"></legend>
// Labels configured in the settings (Settings > Captions). In the report (html2ooxml): paragraph with the style
// Caption, "<label> <number (SEQ field)> - <text>"
export default Node.create({
  name: "caption",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: "Figure",
        parseHTML: (element) => element.getAttribute("label") || "Figure",
        renderHTML: (attributes) => ({ label: attributes.label }),
      },
      alt: {
        default: "",
        parseHTML: (element) => element.getAttribute("alt") || "",
        renderHTML: (attributes) => ({ alt: attributes.alt || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "legend" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["legend", HTMLAttributes];
  },

  addCommands() {
    return {
      // A selected node (image just uploaded, table) is kept: the caption is inserted after it instead of replacing it
      caption:
        (attributes) =>
        ({ state, commands }) =>
          state.selection instanceof NodeSelection
            ? commands.insertContentAt(state.selection.to, { type: this.name, attrs: attributes })
            : commands.insertContent({ type: this.name, attrs: attributes }),
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(CaptionView);
  },
});
