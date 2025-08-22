import Image from "@tiptap/extension-image";
import { Plugin, PluginKey } from "prosemirror-state";
import { VueNodeViewRenderer } from "@tiptap/vue-3";

import uploadImage from "./uploadImage.vue";
import ImageService from "@/services/image";
import Utils from "@/services/utils";

export default Image.extend({
  name: "custom_image",

  addOptions() {
    return {
      ...Image.options,
    };
  },
  group: "block",
  draggable: true,

  addAttributes() {
    return {
      ...Image.config.addAttributes(),
      attrs: {
        src: {},
        alt: {
          default: "",
        },
      },
      group: "block",
      draggable: true,
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs: (dom) => ({
            src: dom.getAttribute("src"),
            alt: dom.getAttribute("alt"),
          }),
        },
      ],
      toDOM: (node) => ["img", node.attrs],
    };
  },
  addCommands() {
    return {
      setImage:
        (options) =>
        ({ tr, dispatch }) => {
          const { selection } = tr;
          const node = this.type.create(options);

          if (dispatch) {
            tr.replaceRangeWith(selection.from, selection.to, node);
          }

          return true;
        },
      setImageAttrs:
        (attrs) =>
        ({ tr, dispatch, state }) => {
          const { selection } = state;
          const options = {
            ...selection.node.attrs,
            ...attrs,
          };
          const node = this.type.create(options);
          if (dispatch) {
            tr.replaceRangeWith(node);
          }
        },
    };
  },
  addProseMirrorPlugins() {
    //https://github.com/ueberdosis/tiptap/issues/1057
    return [
      new Plugin({
        key: new PluginKey("eventHandler"),
        props: {
          handleDOMEvents: {
            drop(view, event) {
              var isImage = false;
              var file = event.dataTransfer.files[0];

              var auditId = null;
              var path = window.location.pathname.split("/");
              if (path && path.length > 3 && path[1] === "audits")
                auditId = path[2];

              // Check first if there are image URLs in the text
              for (let i = 0; i < event.dataTransfer.items.length; i++) {
                const item = event.dataTransfer.items[i];
                if (item.type === "text/plain") {
                  item.getAsString((text) => {
                    if (Utils.isImageUrl(text)) {
                      isImage = true;
                      const { schema } = view.state;
                      const node = schema.nodes.custom_image.create({
                        src: text,
                        alt: "External Image",
                      });
                      const { selection } = view.state.tr;
                      const transaction = view.state.tr.replaceRangeWith(
                        selection.from,
                        selection.to,
                        node
                      );
                      view.dispatch(transaction);
                    }
                  });
                  if (isImage) break;
                }
              }

              // Process image files
              if (file && file.type.startsWith("image")) {
                isImage = true;
                const { schema } = view.state;

                var fileReader = new FileReader();

                fileReader.onloadend = (e) => {
                  Utils.resizeImg(fileReader.result)
                    .then((data) => {
                      return ImageService.createImage({
                        value: data,
                        name: file.name,
                        auditId: auditId,
                      });
                    })
                    .then((data) => {
                      const node = schema.nodes.custom_image.create({
                        src: data.data.datas._id,
                        alt: file.name,
                      });
                      const { selection } = view.state.tr;
                      const transaction = view.state.tr.replaceRangeWith(
                        selection.from,
                        selection.to,
                        node
                      );
                      view.dispatch(transaction);
                    })
                    .catch((err) => console.log(err));
                };

                fileReader.readAsDataURL(file);
              }

              if (isImage) {
                event.preventDefault();
                return true;
              }
            },
            paste(view, event) {
              var isImage = false;
              var auditId = null;
              var path = window.location.pathname.split("/");
              if (path && path.length > 3 && path[1] === "audits")
                auditId = path[2];

              // Iterate through all clipboard items to find image URLs
              for (let i = 0; i < event.clipboardData.items.length; i++) {
                const item = event.clipboardData.items[i];
                
                // Check if it's text (potential image URL)
                if (item.type === "text/plain") {
                  item.getAsString((text) => {
                    if (Utils.isImageUrl(text)) {
                      isImage = true;
                      const { schema } = view.state;
                      const node = schema.nodes.custom_image.create({
                        src: text,
                        alt: "External Image",
                      });
                      const { selection } = view.state.tr;
                      const transaction = view.state.tr.replaceRangeWith(
                        selection.from,
                        selection.to,
                        node
                      );
                      view.dispatch(transaction);
                    }
                  });
                  if (isImage) break;
                }
                
                // Check if it's an image file
                if (item.type.startsWith("image")) {
                  var blob = item.getAsFile();
                  isImage = true;
                  const { schema } = view.state;
                  var fileReader = new FileReader();

                  fileReader.onloadend = (e) => {
                    Utils.resizeImg(fileReader.result)
                      .then((data) => {
                        return ImageService.createImage({
                          value: data,
                          name: blob.name || "image",
                          auditId: auditId,
                        });
                      })
                      .then((data) => {
                        const node = schema.nodes.custom_image.create({
                          src: data.data.datas._id,
                          alt: blob.name || "image",
                        });
                        const { selection } = view.state.tr;
                        const transaction = view.state.tr.replaceRangeWith(
                          selection.from,
                          selection.to,
                          node
                        );

                        view.dispatch(transaction);
                      })
                      .catch((err) => console.log(err));
                  };

                  fileReader.readAsDataURL(blob);
                  break;
                }
              }

              if (isImage) {
                event.preventDefault();
                return true;
              }
            },
          },
        },
      }),
    ];
  },
  addNodeView() {
    return VueNodeViewRenderer(uploadImage);
  },
});
