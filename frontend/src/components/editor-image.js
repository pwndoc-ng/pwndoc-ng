import Image from "@tiptap/extension-image";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { VueNodeViewRenderer } from "@tiptap/vue-3";

import { Notify } from "quasar";

import uploadImage from "./uploadImage.vue";
import ImageService from "@/services/image";
import Utils from "@/services/utils";
import { $t } from "@/boot/i18n";

// Images being uploaded (pasted, dropped or chosen in the toolbar): place of the insertion (selection when the image was
// added), mapped through the changes made during the upload. The image is inserted there when the upload is done, not
// over the text selected meanwhile.
const uploadsKey = new PluginKey("imageUploads");
let lastUploadId = 0;

const uploadsPlugin = new Plugin({
  key: uploadsKey,
  state: {
    init: () => [],
    apply(tr, uploads) {
      let next = uploads.map(({ id, from, to }) => {
        // Text typed at the place of the image stays after it; a replaced selection only shrinks
        const mappedFrom = tr.mapping.map(from, from === to ? -1 : 1);
        return { id, from: mappedFrom, to: from === to ? mappedFrom : Math.max(mappedFrom, tr.mapping.map(to, -1)) };
      });
      const meta = tr.getMeta(uploadsKey);
      if (meta && meta.add) next.push(meta.add);
      if (meta && meta.remove) next = next.filter((upload) => upload.id !== meta.remove);
      return next;
    },
  },
});

// Remembers the place of an image being uploaded (selection of the view by default): returns the id of the upload
function startImageUpload(view, { from, to } = view.state.selection) {
  const id = ++lastUploadId;
  view.dispatch(view.state.tr.setMeta(uploadsKey, { add: { id, from, to } }).setMeta("addToHistory", false));
  return id;
}

// Inserts the uploaded image at the place of the upload (nothing when the editor was destroyed meanwhile). When the user
// waited there, the cursor is put after the image: a caption or the text typed next goes after it, without replacing it
function insertUploadedImage(view, id, attrs) {
  if (view.isDestroyed) return false;
  const upload = uploadsKey.getState(view.state).find((u) => u.id === id);
  if (!upload) return false;
  const { selection } = view.state;
  const waited = selection.empty && selection.from === upload.from;
  const node = view.state.schema.nodes.custom_image.create(attrs);
  const tr = view.state.tr.replaceRangeWith(upload.from, upload.to, node).setMeta(uploadsKey, { remove: id });
  if (waited) {
    let end = upload.to;
    tr.steps[tr.steps.length - 1].getMap().forEach((oldStart, oldEnd, newStart, newEnd) => { end = newEnd; });
    const $end = tr.doc.resolve(end);
    tr.setSelection(GapCursor.valid($end) ? new GapCursor($end) : Selection.near($end));
  }
  view.dispatch(tr);
  return true;
}

function cancelImageUpload(view, id) {
  if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(uploadsKey, { remove: id }).setMeta("addToHistory", false));
}

function notifyImageUploadError(err) {
  Notify.create({
    message: $t("imageUploadFailed"),
    caption: (err && err.response && err.response.data && err.response.data.datas) || (err && err.message) || "",
    color: "negative",
    textColor: "white",
    position: "top-right",
  });
}

// Audit of the page (the images of an audit are stored with it), null outside the audits
function pageAuditId() {
  const path = window.location.pathname.split("/");
  return path.length > 3 && path[1] === "audits" ? path[2] : null;
}

// Upload of an image file (pasted, dropped or chosen in the toolbar): resized, stored, then inserted at the place of the
// upload (selection of the view by default). The failures are notified.
export function uploadImageFile(view, file, name, range) {
  const auditId = pageAuditId();
  const uploadId = startImageUpload(view, range);
  const fileReader = new FileReader();
  fileReader.onloadend = () => {
    Utils.resizeImg(fileReader.result)
      .then((data) => ImageService.createImage({ value: data, name, auditId }))
      .then((data) => insertUploadedImage(view, uploadId, { src: data.data.datas._id, alt: name }))
      .catch((err) => {
        cancelImageUpload(view, uploadId);
        notifyImageUploadError(err);
      });
  };
  fileReader.readAsDataURL(file);
}

// Image of another site (URL pasted or dropped): not uploaded
function insertExternalImage(view, src, { from, to }) {
  const node = view.state.schema.nodes.custom_image.create({ src, alt: "External Image" });
  view.dispatch(view.state.tr.replaceRangeWith(from, to, node));
}

export default Image.extend({
  name: "custom_image",

  addOptions() {
    return {
      ...this.parent?.(),
    };
  },
  group: "block",
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      // Width in the editor and in the report: small, medium or large (between page margins).
      // null: default width from settings. Rendered after src and alt (order expected by the report generator).
      width: {
        default: null,
        parseHTML: (element) => {
          const width = element.getAttribute("data-width");
          return ["small", "medium", "large"].includes(width) ? width : null;
        },
        renderHTML: (attributes) => (attributes.width ? { "data-width": attributes.width } : {}),
      },
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
      // Attributes of the selected image (caption, width)
      setImageAttrs:
        (attrs) =>
        ({ tr, dispatch, state }) => {
          const { selection } = state;
          if (!selection.node || selection.node.type !== this.type) return false;
          if (dispatch) tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, ...attrs });
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    //https://github.com/ueberdosis/tiptap/issues/1057
    // The texts of the clipboard and of the drop are read with getData (synchronous): the handler must know at once whether
    // it handles the event (getAsString answers later, the URL text was pasted in addition to the image)
    return [
      uploadsPlugin,
      new Plugin({
        key: new PluginKey("eventHandler"),
        props: {
          handleDOMEvents: {
            drop(view, event) {
              const file = event.dataTransfer.files[0];
              const isImageFile = !!file && file.type.startsWith("image");
              const text = event.dataTransfer.getData("text/plain");
              if (!isImageFile && !Utils.isImageUrl(text)) return false;
              // Image inserted where it is dropped
              const dropped = view.posAtCoords({ left: event.clientX, top: event.clientY });
              const range = dropped ? { from: dropped.pos, to: dropped.pos } : view.state.selection;
              if (isImageFile) uploadImageFile(view, file, file.name, range);
              else insertExternalImage(view, text, range);
              event.preventDefault();
              return true;
            },
            paste(view, event) {
              // First image of the clipboard, or an image URL
              const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image"));
              const text = event.clipboardData.getData("text/plain");
              if (imageItem) {
                const blob = imageItem.getAsFile();
                uploadImageFile(view, blob, blob.name || "image");
              }
              else if (Utils.isImageUrl(text)) insertExternalImage(view, text, view.state.selection);
              else return false;
              event.preventDefault();
              return true;
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
