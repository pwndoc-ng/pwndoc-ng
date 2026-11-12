<template>
  <q-card
    v-if="editor"
    flat
    bordered
    class="editor full-width"
    :class="affixRelativeElement"
    :style="editable ? '' : 'border: 1px dashed lightgrey'"
    :aria-busy="loadingContent"
  >
  <div v-sticky sticky-offset="stickyConfig"  class="bg-white">
      <q-toolbar class="editor-toolbar">
        <div v-if="toolbar.indexOf('format') !== -1">
          <q-tooltip :delay="500" content-class="text-bold"
            >Text Format</q-tooltip
          >
          <q-btn-dropdown
            size="sm"
            unelevated
            dense
            :icon="formatIcon"
            :label="formatLabel"
            style="width: 42px"
            class="text-bold"
            auto-close
            no-refocus
            :disable="!canEdit"
          >
            <q-list dense>
              <q-item
                clickable
                :class="{ 'is-active': editor.isActive('paragraph') }"
                @click="editor.chain().focus().setParagraph().run()"
              >
                <q-item-section>
                  <q-icon name="fa fa-paragraph" />
                </q-item-section>
              </q-item>
              <q-item
                clickable
                :class="{
                  'is-active': editor.isActive('heading', { level: 1 }),
                }"
                @click="
                  editor.chain().focus().toggleHeading({ level: 1 }).run()
                "
              >
                <q-item-section>H1</q-item-section>
              </q-item>
              <q-item
                clickable
                :class="{
                  'is-active': editor.isActive('heading', { level: 2 }),
                }"
                @click="
                  editor.chain().focus().toggleHeading({ level: 2 }).run()
                "
              >
                <q-item-section>H2</q-item-section>
              </q-item>
              <q-item
                clickable
                :class="{
                  'is-active': editor.isActive('heading', { level: 3 }),
                }"
                @click="
                  editor.chain().focus().toggleHeading({ level: 3 }).run()
                "
              >
                <q-item-section>H3</q-item-section>
              </q-item>
              <q-item
                clickable
                :class="{
                  'is-active': editor.isActive('heading', { level: 4 }),
                }"
                @click="
                  editor.chain().focus().toggleHeading({ level: 4 }).run()
                "
              >
                <q-item-section>H4</q-item-section>
              </q-item>
              <q-item
                clickable
                :class="{
                  'is-active': editor.isActive('heading', { level: 5 }),
                }"
                @click="
                  editor.chain().focus().toggleHeading({ level: 5 }).run()
                "
              >
                <q-item-section>H5</q-item-section>
              </q-item>
              <q-item
                clickable
                :class="{
                  'is-active': editor.isActive('heading', { level: 6 }),
                }"
                @click="
                  editor.chain().focus().toggleHeading({ level: 6 }).run()
                "
              >
                <q-item-section>H6</q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>
        <q-separator
          vertical
          class="q-mx-sm"
          v-if="toolbar.indexOf('format') !== -1"
        />
        <div v-if="toolbar.indexOf('marks') !== -1">
          <!-- Highlight dropdown button -->
          <q-btn-dropdown
            size="sm"
            unelevated
            dense
            :icon="highlightIcon"
            style="width: 42px"
            class="text-bold"
            auto-close
            no-refocus
            :disable="!canEdit"
          >
            <q-tooltip :delay="500" content-class="text-bold"
              >Highlight</q-tooltip
            >
            <q-list dense>
              <q-item
                clickable
                :class="{ 'is-active': editor.isActive('highlight') }"
                @click="
                  editor
                    .chain()
                    .focus()
                    .toggleHighlight({ color: '#ffff00' })
                    .run()
                "
                style="background-color: yellow"
              >
              </q-item>
              <q-item
                clickable
                :class="{ 'is-active': editor.isActive('highlight') }"
                @click="
                  editor
                    .chain()
                    .focus()
                    .toggleHighlight({ color: '#fe0000' })
                    .run()
                "
                style="background-color: red"
              >
              </q-item>
              <q-item
                clickable
                :class="{ 'is-active': editor.isActive('highlight') }"
                @click="
                  editor
                    .chain()
                    .focus()
                    .toggleHighlight({ color: '#00ff00' })
                    .run()
                "
                style="background-color: #00ff00"
              >
              </q-item>
              <q-item
                clickable
                :class="{ 'is-active': editor.isActive('highlight') }"
                @click="
                  editor
                    .chain()
                    .focus()
                    .toggleHighlight({ color: '#00ffff' })
                    .run()
                "
                style="background-color: #00ffff"
              >
              </q-item>
            </q-list>
          </q-btn-dropdown>
          <!-- Highlight dropdown button end -->

          <!-- Bold button -->
          <q-btn
            :disable="!canEdit"
            flat
            size="sm"
            dense
            :class="{ 'is-active': editor.isActive('bold') }"
            @click="editor.chain().focus().toggleBold().run()"
          >
            <q-tooltip :delay="500" content-class="text-bold">Bold</q-tooltip>
            <q-icon name="format_bold" />
          </q-btn>
          <!-- Bold button end -->
          <!-- Italic button -->
          <q-btn
            :disable="!canEdit"
            flat
            size="sm"
            dense
            :class="{ 'is-active': editor.isActive('italic') }"
            @click="editor.chain().focus().toggleItalic().run()"
          >
            <q-tooltip :delay="500" content-class="text-bold">Italic</q-tooltip>
            <q-icon name="format_italic" />
          </q-btn>
          <!-- Italic button end -->
          <!-- Underline button -->
          <q-btn
            :disable="!canEdit"
            flat
            size="sm"
            dense
            @click="editor.chain().focus().toggleUnderline().run()"
            :class="{ 'is-active': editor.isActive('underline') }"
          >
            <q-tooltip :delay="500" content-class="text-bold"
              >Underline</q-tooltip
            >
            <q-icon name="format_underline" />
          </q-btn>
          <!-- Underline button end -->
          <!-- Strike button -->
          <q-btn
            :disable="!canEdit"
            flat
            size="sm"
            dense
            :class="{ 'is-active': editor.isActive('strike') }"
            @click="editor.chain().focus().toggleStrike().run()"
          >
            <q-tooltip :delay="500" content-class="text-bold">Strike</q-tooltip>

            <q-icon name="format_strikethrough" />
          </q-btn>
          <q-btn
            :disable="!canEdit"
            flat
            size="sm"
            dense
            :class="{ 'is-active': editor.isActive('link') }"
            @click="setLink"
          >
            <q-tooltip :delay="500" content-class="text-bold">set a link</q-tooltip>
            <q-icon name="mdi-link" />
          </q-btn>
      <q-btn
            flat
            size="sm"
            dense
            @click="editor.chain().focus().unsetLink().run()"
            :disable="!canEdit || !editor.isActive('link')"
          >
            <q-tooltip :delay="500" content-class="text-bold">unset a link</q-tooltip>
            <q-icon name="mdi-link-off" />
          </q-btn>


          <!-- Strike button end -->
        </div>

        <q-separator
          vertical
          class="q-mx-sm"
          v-if="toolbar.indexOf('marks') !== -1"
        />
        <div v-if="toolbar.indexOf('list') !== -1">
          <!-- Bullet list -->
          <q-btn
            :disable="!canEdit"
            flat
            size="sm"
            dense
            @click="editor.chain().focus().toggleBulletList().run()"
            :class="{ 'is-active': editor.isActive('bulletList') }"
          >
            <q-tooltip :delay="500" content-class="text-bold"
              >Bulleted list</q-tooltip
            >
            <q-icon name="format_list_bulleted" />
          </q-btn>
          <!-- Bullet list end-->
          <!-- Number list -->
          <q-btn
            :disable="!canEdit"
            flat
            size="sm"
            dense
            @click="editor.chain().focus().toggleOrderedList().run()"
            :class="{ 'is-active': editor.isActive('orderedList') }"
          >
            <q-tooltip :delay="500" content-class="text-bold"
              >Numbered list</q-tooltip
            >
            <q-icon name="format_list_numbered" />
          </q-btn>
          <!-- Number list end-->
        </div>
        <q-separator
          vertical
          class="q-mx-sm"
          v-if="toolbar.indexOf('list') !== -1"
        />

        <div v-if="toolbar.indexOf('code') !== -1">
          <q-btn flat size="sm" dense :disable="!canEdit"
                 :class="{ 'is-active': editor.isActive('code') }"
                 @click="editor.chain().focus().toggleCode().run()"
          >
            <q-tooltip :delay="500" content-class="text-bold">Code</q-tooltip>
            <q-icon name="code" />
          </q-btn>

          <q-btn flat size="sm" dense :disable="!canEdit"
                 :class="{ 'is-active': editor.isActive('codeBlock') }"
                 @click="editor.chain().focus().toggleCodeBlock().run()"
          >
            <q-tooltip :delay="500" content-class="text-bold">Code Block</q-tooltip>
            <q-icon name="mdi-console" />
          </q-btn>
        </div>

        <q-separator
            vertical
            class="q-mx-sm"
            v-if="toolbar.indexOf('table') !== -1"
        />

        <div v-if="toolbar.indexOf('table') !== -1">
          <!-- Add Table -->
          <q-btn
            :disable="!canEdit"
            flat
            size="sm"
            dense
            @click="
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            "
          >
            <q-tooltip :delay="500" content-class="text-bold"
              >Insert table</q-tooltip
            >
            <q-icon name="mdi-table" />
          </q-btn>
          <q-btn
              :disable="!canEdit"
              flat
              size="sm"
              dense
              @click="
              editor.chain().focus().addColumnAfter().run()
            "
          >
            <q-tooltip :delay="500" content-class="text-bold"
            >Add column</q-tooltip
            >
            <q-icon name="mdi-table-column-plus-after" />
          </q-btn>
          <q-btn
              :disable="!canEdit"
              flat
              size="sm"
              dense
              @click="
              editor.chain().focus().addRowAfter().run()
            "
          >
            <q-tooltip :delay="500" content-class="text-bold"
            >Add row</q-tooltip
            >
            <q-icon name="mdi-table-row-plus-after" />
          </q-btn>
          <q-btn
              :disable="!canEdit"
              flat
              size="sm"
              dense
              @click="
              editor.chain().focus().mergeCells().run()
            "
          >
            <q-tooltip :delay="500" content-class="text-bold"
            >Merge cells</q-tooltip
            >
            <q-icon name="mdi-call-merge" />
          </q-btn>

          <q-btn
              flat
              size="sm"
              dense
              @click="editor.chain().focus().deleteRow().run()" :disable="!canEdit || !editor.can().deleteRow()"
          >
            <q-tooltip :delay="500" content-class="text-bold"
            >Delete Table Row</q-tooltip
            >
            <q-icon name="mdi-table-row-remove" />
          </q-btn>

          <q-btn
              flat
              size="sm"
              dense
              @click="editor.chain().focus().deleteColumn().run()" :disable="!canEdit || !editor.can().deleteColumn()"
          >
            <q-tooltip :delay="500" content-class="text-bold"
            >Delete Table Column</q-tooltip>
            <q-icon name="mdi-table-column-remove" />
          </q-btn>

          <q-btn
            flat
            size="sm"
            dense
            @click="editor.chain().focus().deleteTable().run()"
            :disable="!canEdit || !editor.can().deleteTable()"
          >
            <q-icon name="delete" />
            <q-tooltip :delay="500" content-class="text-bold"
            >Delete table</q-tooltip
            >
          </q-btn>
          <!-- Add Table end -->
        </div>
        <q-separator
          vertical
          class="q-mx-sm"
          v-if="toolbar.indexOf('code') !== -1"
        />
        <!-- Image upload -->
        <div v-if="toolbar.indexOf('image') !== -1">
          <q-tooltip :delay="500" content-class="text-bold">
            Insert Image
          </q-tooltip>
          <q-btn flat size="sm" dense :disable="!canEdit">
            <label class="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                class="hidden"
                @change="importImage($event.target.files)"
                :disabled="!canEdit"
              />
              <q-icon name="image" />
            </label>
          </q-btn>
        </div>
        <q-separator
          vertical
          class="q-mx-sm"
          v-if="toolbar.indexOf('image') !== -1"
        />
        <!-- Image upload end -->
        <div v-if="toolbar.indexOf('caption') !== -1">
          <q-tooltip :delay="500" content-class="text-bold">
            Insert Caption</q-tooltip
          >
          <q-btn-dropdown flat size="sm" dense icon="subtitles" no-refocus :disable="!canEdit">
            <q-list dense>
              <q-item
                v-for="caption of $settings.report.public.captions"
                :key="caption"
                clickable
                v-close-popup
                @click="
                  editor
                    .chain()
                    .focus()
                    .caption({ label: caption, alt: '' })
                    .run()
                "
              >
                <q-item-section>{{ caption }}</q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>
        <q-separator
          vertical
          class="q-mx-sm"
          v-if="toolbar.indexOf('caption') !== -1"
        />

        <q-btn
          :disable="!canEdit"
          flat
          size="sm"
          dense
          @click="editor.chain().focus().undo().run()"
        >
          <q-tooltip :delay="500" content-class="text-bold">Undo</q-tooltip>
          <q-icon name="undo" />
        </q-btn>

        <q-btn
          :disable="!canEdit"
          flat
          size="sm"
          dense
          @click="editor.chain().focus().redo().run()"
        >
          <q-tooltip :delay="500" content-class="text-bold">Redo</q-tooltip>
          <q-icon name="redo" />
        </q-btn>

        <!-- Assisted writing (AI enabled in the settings and allowed to the user) -->
        <template v-if="aiAssist">
          <q-separator vertical class="q-mx-sm" />
          <ai-assist-button :editor="editor" :audit-id="$route.params.auditId || ''" :disable="!canEdit" />
        </template>

        <q-separator
          vertical
          class="q-mx-sm"
          v-if="diff !== undefined && (diff || modelValue) && modelValue !== diff"
        />
        <div v-if="diff !== undefined && (diff || modelValue) && modelValue !== diff">
          <q-btn
            flat
            size="sm"
            dense
            :class="{ 'is-active': toggleDiff }"
            label="toggle diff"
            @click="toggleDiff = !toggleDiff"
          />
        </div>
      </q-toolbar>
    </div>
    <q-separator />
    <!-- TipTap moves the element of the bubble menus next to the selection: the conditional nodes of the card are kept in
         fixed wrappers, otherwise Vue inserts them before a moved bubble menu (NotFoundError, page no longer updated) -->
    <div class="editor-state">
      <!-- Content not loaded yet (value of the page, collaboration websocket): read-only until then -->
      <q-linear-progress v-if="loadingContent" class="editor-loading" indeterminate color="secondary" size="2px" />
      <!-- Collaborative editing refused by the server or server not answering: read-only, retry possible -->
      <div v-else-if="collabError" class="editor-unavailable row items-center no-wrap q-px-sm text-caption text-negative">
        <q-icon name="mdi-cloud-off-outline" class="q-mr-xs" />
        <span class="col">{{ collabError.kind === 'unavailable' ? $t('editorCollabUnavailable', [collabError.reason]) : $t('editorCollabUnreachable') }}</span>
        <q-btn flat dense no-caps size="sm" color="negative" :label="$t('editorCollabRetry')" @click="recreateEditor" />
      </div>
      <!-- Collaboration websocket lost: the changes are kept and shared once connected again -->
      <div v-else-if="shared && status !== 'connected'" class="editor-disconnected row items-center no-wrap q-px-sm text-caption text-orange-9">
        <q-icon name="mdi-wifi-off" class="q-mr-xs" />{{ $t('editorDisconnected') }}
      </div>
      <!-- Value of the page shown while the shared content cannot be loaded -->
      <div v-if="previewShown" class="editor__content editor-preview q-pa-sm">
        <div class="ProseMirror" v-html="previewContent"></div>
      </div>
    </div>
    <!-- Formatting and LanguageTool menus: not shown when the audit is in review, where a selection is made to comment it -->
    <div class="editor-menu-wrapper">
     <bubble-menu
      class="editor-bubble-menu"
      :editor="editor"
      :options="{ placement: 'top', offset: 6 }"
      v-if="editor && !commentMode"
    >
      <button @click="editor.chain().focus().toggleBold().run()" :class="{ 'is-active': editor.isActive('bold') }">
        <q-icon name="format_bold" />
      </button>
      <button @click="editor.chain().focus().toggleItalic().run()" :class="{ 'is-active': editor.isActive('italic') }">
        <q-icon name="format_italic" />
      </button>
      <button @click="editor.chain().focus().toggleStrike().run()" :class="{ 'is-active': editor.isActive('strike') }">
        <q-icon name="format_strikethrough" />
      </button>
      <button :class="{ 'is-active': editor.isActive('code') }"   @click="editor.chain().focus().toggleCode().run()" >
        <q-icon name="code" />
      </button>
      <button   @click="editor.isActive('link') ? editor.chain().focus().unsetLink().run() : setLink()" >
        <q-icon :name="editor.isActive('link') ? 'mdi-link-off' : 'mdi-link' " />
      </button>
      <!-- Comment the selected passage (audit not in review: the comment action is part of this menu) -->
      <button v-if="commentable" class="editor-bubble-menu__comment" @mousedown.prevent @click="commentSelectedText">
        <q-icon name="mdi-comment-plus-outline" />
        <q-tooltip :delay="500">{{ $t('comments.commentSelection') }}</q-tooltip>
      </button>


    </bubble-menu>
    </div>
    <div class="editor-menu-wrapper">
    <!-- LanguageTool suggestions: shown only while the text of a reported mistake is selected -->
    <bubble-menu
  class="bubble-menu"
  v-if="editor && !commentMode"
  :editor="editor"
  :should-show="showLanguageToolMenu"
  :options="{ placement: 'bottom', offset: 6 }"
>
  <section class="bubble-menu-section-container">
    <section class="message-section">
      {{ matchMessage }}
    </section>
    <section class="suggestions-section">
      <article
        v-for="(replacement, i) in replacements"
        @click="() => acceptSuggestion(replacement)"
        :key="i + replacement.value"
        class="suggestion"
      >
        {{ replacement.value }}
      </article>
    </section>
    <!-- Word to ignore: proposed to the administrators, ignored for all the users once approved -->
    <section v-if="ignorableWord" class="ignore-section">
      <article class="suggestion suggestion--ignore" @mousedown.prevent @click="proposeIgnoredWord">
        <q-icon name="mdi-book-plus-outline" class="q-mr-xs" />{{ $t('spellcheck.ignoreWord', [ignorableWord]) }}
      </article>
    </section>
  </section>
</bubble-menu>
    </div>
    <editor-content
      v-if="typeof diff === 'undefined' || !toggleDiff"
      v-show="!previewShown"
      class="editor__content q-pa-sm"
      :editor="editor"
      @dblclick="zoomImage"
      @mouseup="checkCommentSelection"
      @keyup="checkCommentSelection"
      @click="onContentClick"
    />
    <div v-else class="editor__content q-pa-sm" @dblclick="zoomImage">
      <div class="ProseMirror" v-html="diffContent"></div>
    </div>
    <!-- Comment the selected passage -->
    <q-btn
      v-if="commentSelection && !commentInFormatMenu"
      class="comment-selection-btn"
      :style="{ top: (commentSelection.top - 40) + 'px', left: commentSelection.left + 'px' }"
      color="orange-8"
      unelevated
      dense
      no-caps
      icon="mdi-comment-plus-outline"
      :label="$t('comments.commentSelection')"
      @mousedown.prevent
      @click="commentOnSelection"
    />

    <!-- Image zoom (double click on an image): fit to screen, click on the image to toggle actual size -->
    <q-dialog v-model="zoom.show" maximized transition-show="fade" transition-hide="fade">
      <div
        class="editor-image-zoom"
        :class="{ 'editor-image-zoom--full': zoom.fullSize }"
        @click.self="zoom.show = false"
      >
        <q-btn class="editor-image-zoom__close" round flat dense icon="close" color="white" @click="zoom.show = false" />
        <img :src="zoom.src" :alt="zoom.alt" @click="zoom.fullSize = !zoom.fullSize" />
        <div v-if="zoom.alt" class="editor-image-zoom__caption">{{ zoom.alt }}</div>
      </div>
    </q-dialog>
  </q-card>
</template>

<script>
import { defineComponent,ref } from 'vue';
import { Notify } from 'quasar';

import { Editor, EditorContent, VueNodeViewRenderer } from "@tiptap/vue-3";
import { BubbleMenu } from "@tiptap/vue-3/menus";
//  Import extensions
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'


import { LanguageTool } from './languagetool'
import { contentExtensions, lowlight } from './editor-extensions'
import { CommentHighlight, commentHighlightKey, quoteFromRange } from "./comment-highlight";
import { TriggerMenuExtension } from './internal-link';
import {v4 as uuidv4} from 'uuid';
import UserService from '@/services/user';
import SpellcheckService from '@/services/spellcheck';
import AiAssistButton from './ai-assist-button.vue';
import { aiAllowed } from '@/services/ai';
import Collaboration from '@tiptap/extension-collaboration'
import { fixPluginRegistration, keepUndoManagerTracking, setInitialCollaborativeContent, initialContentIds } from './editor-collaboration'
import { uploadImageFile } from './editor-image'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'



import CodeBlockComponent from './CodeBlockComponent.vue'

const Diff = require("diff");
//  Internal libs
import Utils from "@/services/utils";


const match = ref(null)


const updateHtmlLanguageTool = () => navigator.clipboard.writeText(editor.value.getHTML())


// Collaborative editor not synchronized after this delay: server considered as not answering (value of the page shown)
const UNREACHABLE_DELAY = 15000

export default defineComponent({
  emits: ['editorchange', 'ready', 'update:modelValue'],
  name: "BasicEditor",

  props: {
    modelValue:{
      type: String,
      default: ''
    },
    editable: {
      type: Boolean,
      default: true,
    },
    collab: {
      type: Boolean,
      default: true,
    },
    idUnique: {
      type: String,
      default: '',
    },
    toolbar: {
      type: Array,
      default: function () {
        return ["format", "marks", "list", "code", "table", "image", "caption"];
      },
    },
    noAffix: {
      type: Boolean,
      default: false,
    },
    diff: String,
    disableDrop: {
      type: Boolean,
      default: false,
    },
    noSync: {
      type: Boolean,
      default: false,
    },
    // Review comments target of this field ({kind, findingId|sectionId, field}): enables comments on passages
    commentTarget: {
      type: Object,
      default: null,
    },
    // Value of the page not loaded yet: the editor waits for it (read-only, nothing written in the shared document)
    loading: {
      type: Boolean,
      default: false,
    },

  },

  // Review comments store of the audit edit page (null outside an audit)
  inject: {
    commentsStore: { from: 'auditComments', default: null },
  },

  components: {
    EditorContent,
    BubbleMenu,
    AiAssistButton
  },

  data() {
    return {
      editor: null,
      json: "",
      html: "",
      toggleDiff: true,
      affixRelativeElement: "affix-relative-element",
      status: 'connecting',
      synced: false, // Shared document synchronized with the server (always true without collaboration)
      fullId:"",
      initialeDataUpdated:false, // Content loaded: editable from then on
      collabError: null, // Shared content not available: {kind: 'unavailable', reason} (refused) or {kind: 'unreachable'}
      emptyInitialValue: false, // Initialized with an empty value and not modified since (value may arrive later)
      earlyText: '', // Characters typed before the content was loaded
      commentSelection: null, // Selected passage to comment: {quote, top, left}
      zoom: {show: false, src: '', alt: '', fullSize: false}, // Image zoom dialog
      htmlEncode: Utils.htmlEncode,
      stickyConfig: {
        zIndex: 1000,
        top: 50,
        sticked: true,
        disabled: false,
        wrapper: true
      }

    };
  },

  watch: {
    // Value received after an initialization with an empty value (e.g. custom fields loaded after the editor), editor
    // still empty and not changed by the user: shown (written in the shared document only if it is still empty).
    // Before the initialization, the last value is loaded by initialize().
    modelValue(value) {
      if (this.initialeDataUpdated && this.emptyInitialValue && value && this.editor && this.editor.getHTML() === '<p></p>') {
        this.emptyInitialValue = false
        this.setInitialCollaborativeContent(value)
      }
    },
    loading(value) {
      if (!value) this.initialize()
    },
    editable(value) {
      if (this.editor) this.editor.setEditable(this.canEdit);
    },
    quoteComments: {
      handler() { this.updateCommentHighlights() },
      deep: true,
    },
    'commentsStore.activeId'() {
      this.updateCommentHighlights()
    },
  },

  mounted() {
    if (this.modelValue === undefined || this.modelValue === null) {
      this.$emit('update:modelValue', '');
    }
     if(this.idUnique == '') {
      this.ClassEditor = uuidv4()
     } else {
      this.ClassEditor = this.idUnique
     }
     this.username = UserService.user.username
     // Field of the shared document of the audit: one per finding or section and per editor
     const { auditId, findingId, sectionId } = this.$route.params
     const element = findingId || sectionId
     this.fullId = element ? `${auditId}-${element}-${this.ClassEditor}` : this.ClassEditor

    this.createEditor()

    // Listen to auto correction toggle changes
    this.autoCorrectionToggleListener = (event) => {
      if (this.editor && this.editor.storage.languagetool) {
        this.editor.storage.languagetool.updateLanguageToolState();
      }
    };
    window.addEventListener('autoCorrectionToggleChanged', this.autoCorrectionToggleListener);

    // Review comments: selection button hidden when scrolling
    this.hideCommentSelection = () => { this.commentSelection = null };
    window.addEventListener('scroll', this.hideCommentSelection, true);

    this.affixRelativeElement += "-" +  this.ClassEditor;
    this.initialize()
  },

  // Released at once, connected or not: an editor of a page left never writes in the shared document
  beforeUnmount() {
    this.destroyed = true
    clearTimeout(this.unreachableTimer)
    window.removeEventListener('scroll', this.hideCommentSelection, true);
    window.removeEventListener('autoCorrectionToggleChanged', this.autoCorrectionToggleListener);
    this.destroyProvider();
    if (this.editor) this.editor.destroy();
  },

  computed: {

    // Name of the shared document: the audit of the page, or the editor (idUnique) outside the audits
    documentName() {
      return this.$route.params.auditId || this.idUnique.replace('-', '/');
    },
    // Collaborative editor: it needs a shared document. An editor without name (no audit, no idUnique) is not shared: the
    // server refuses the empty name and the editor would wait for a synchronization that never comes
    shared() {
      return this.collab && !!this.documentName;
    },
    // Toolbar usable: editable editor whose content is loaded and shared (the commands of TipTap ignore the read-only state)
    canEdit() {
      return this.editable && this.initialeDataUpdated && !this.collabError;
    },
    loadingContent() {
      return !this.initialeDataUpdated && !this.collabError;
    },
    previewShown() {
      return !this.initialeDataUpdated && !!this.collabError;
    },
    previewContent() {
      return this.withImageUrls(Utils.htmlEncode(this.htmlValue(this.modelValue)));
    },
    commentable() {
      return !!(this.commentsStore && this.commentTarget);
    },
    // Comment mode: audit in review, selecting a passage only proposes to comment it (no formatting menu)
    commentMode() {
      return this.commentable && this.commentsStore.inReview();
    },
    // Editable editor outside review: the comment action is in the formatting menu of the selection
    commentInFormatMenu() {
      return this.commentable && !this.commentMode && this.editable;
    },
    // Open comments on passages and images of this field (highlighted)
    quoteComments() {
      if (!this.commentable) return [];
      return this.commentsStore.forTarget(this.commentTarget).filter(comment => (comment.quote || comment.image) && !comment.resolved);
    },

    match() {
      return this.editor ? this.editor.storage.languagetool.match.value : null;
    },
    matchMessage() {
     // console.log('matchmessage',this.match.message,this.match)
      return this.match?.message || 'No Message';
    },
    replacements() {
      //console.log('remplacements',this.match.replacements,this.match)
      return this.match?.replacements || [];
    },
    // Assisted writing offered in the toolbar: AI enabled in the settings and allowed to the user
    aiAssist() {
      return aiAllowed(this.$settings, 'ai:assist');
    },
    // Selected word of a reported mistake that the user can propose to ignore (a single word)
    ignorableWord() {
      if (!this.match || !this.editor || !UserService.isAllowed('spellcheck-words:create')) return null;
      const { from, to } = this.editor.state.selection;
      const word = this.editor.state.doc.textBetween(from, to).trim();
      return /^\S{1,100}$/.test(word) ? word : null;
    },
    formatIcon: function () {
      if (this.editor.isActive("paragraph")) return "fa fa-paragraph";
      else return null;
    },
    highlightIcon: function () {
      return "fa fa-highlighter";
    },

    formatLabel: function () {
      if (this.editor.isActive("heading", { level: 1 })) return "H1";
      else if (this.editor.isActive("heading", { level: 2 })) return "H2";
      else if (this.editor.isActive("heading", { level: 3 })) return "H3";
      else if (this.editor.isActive("heading", { level: 4 })) return "H4";
      else if (this.editor.isActive("heading", { level: 5 })) return "H5";
      else if (this.editor.isActive("heading", { level: 6 })) return "H6";
    },

    diffContent: function () {
      var content = "";
      if (typeof this.diff !== "undefined") {
        var HtmlDiff = new Diff.Diff(true);
        HtmlDiff.tokenize = function (value) {
          return value.split(
            /([{}:;,.]|<p>|<\/p>|<pre><code>|<\/code><\/pre>|<[uo]l><li>.*<\/li><\/[uo]l>|\s+)/
          );
        };
        // Both versions are sanitized before the diff (broken tags cannot smuggle attributes through the
        // diff markers), and the result is sanitized again before v-html
        var value = Utils.htmlEncode(this.modelValue || "");
        var previous = Utils.htmlEncode(this.diff || "");
        var diff = HtmlDiff.diff(previous, value);
        diff.forEach((part) => {
          const diffclass = part.added
            ? "diffadd"
            : part.removed
            ? "diffrem"
            : "diffeq";
          var value = part.value.replace(/<p><\/p>/g, "<p><br></p>");
          if (part.added || part.removed) {
            value = value
              .replace(
                /(<p>)(.+?)(<\/p>|$)/g,
                `$1<span class="${diffclass}">$2</span>$3`
              ) // Insert span diffclass in paragraphs
              .replace(
                /(<pre><code>)(.+?)(<\/code><\/pre>|$)/g,
                `$1<span class="${diffclass}">$2</span>$3`
              ) // Insert span diffclass in codeblocks
              .replace(
                /(^[^<].*?)(<|$)/g,
                `<span class="${diffclass}">$1</span>$2`
              ); // Insert span diffclass if text only
          }
          content += value;
        });
      }
      return this.withImageUrls(Utils.htmlEncodeDiff(content));
    },
  },

  methods: {
    // TipTap Collaboration restores the undo manager of the collaboration when the plugin views are recreated (the
    // bubble menus register their plugin when mounted), but loses track of it when the views are destroyed several
    // times in a row: undone changes could no longer be redone. The undo manager must track its own transactions
    // (default of Yjs) to fill the redo stack.
    // Collaborative editors: see editor-collaboration.js
    // Editor and, for the collaborative editors, Yjs document and connection to the shared document
    createEditor() {
      let extensionEditor = [
          // Content of the editor (schema and HTML): editor-extensions.js
          ...contentExtensions({
            collab: this.shared,
            codeBlock: CodeBlockLowlight
              .extend({
                addNodeView() {
                  return VueNodeViewRenderer(CodeBlockComponent)
                },
              })
              .configure({ lowlight }),
          }),
          TriggerMenuExtension,
          CommentHighlight.configure(), // New instance per editor: its storage (field target) must not be shared
          LanguageTool.configure({
            check: (text) => SpellcheckService.check(text), // LanguageTool through the backend (authenticated)
            language: 'auto',   
            automaticMode: true, // 1 second delay before verification
            ignoredWords: () => SpellcheckService.ignoredWords(), // Words approved by the administrators
          }),
        ]
       if(this.shared){
         const ydoc = new Y.Doc()

         // Events of a provider replaced since (shared document reloaded) are ignored
         const provider = new HocuspocusProvider({
          url: `wss://${window.location.hostname}${window.location.port != '' ? ':'+window.location.port : ''}/collab/`,
          //url:"wss://127.0.0.1:8443/collab/",
          name: this.documentName,
          document  : ydoc,
          // Authentication message waited by the server before sharing the document (the user is authenticated server
          // side with the httpOnly token cookie): ids of the initial contents of the fields of the copy of this client,
          // refused by the server when a field was initialized meanwhile from another value of the database (stale-document)
          token: () => JSON.stringify({ init: initialContentIds(ydoc) }),
        })
        this.provider = provider

        provider.on('status', event => {
          if (this.destroyed || this.provider !== provider) return
          this.status = event.status
          // Content of the shared document unknown until the next synchronization (Hocuspocus emits 'synced' only with true)
          if (event.status !== 'connected') this.synced = false
        })
        provider.on('synced', event => {
          if (this.destroyed || this.provider !== provider) return
          this.synced = !!event.state
          this.initialize()
        })
        provider.on('authenticationFailed', ({ reason }) => {
          if (this.destroyed || this.provider !== provider) return
          if (reason === 'stale-document') this.reloadSharedDocument()
          else this.stopCollaboration(reason)
        })
        // Server not answering: the state is shown (the provider keeps trying, the editor is loaded once synchronized)
        clearTimeout(this.unreachableTimer)
        this.unreachableTimer = setTimeout(() => {
          if (!this.destroyed && this.provider === provider && !this.synced && !this.collabError) this.collabError = { kind: 'unreachable' }
        }, UNREACHABLE_DELAY)
        extensionEditor.push(Collaboration.configure({
            document: ydoc,
            field: this.fullId
        }))
        extensionEditor.push(CollaborationCaret.configure({
            provider: provider,
            user: {
              name:  this.username,
              color:  this.stringToColour(this.username)
            }
        }))

      } else {
        this.synced = true
        this.status = 'connected'

      }

      this.editor = new Editor({
        editable: false,
        extensions: extensionEditor ,
        editorProps: {
          // Read-only editor (review): kept focusable so that a click selects text. Otherwise the focus goes to the
          // focusable wrapper of the q-field around the editor, which hands it to another control and cancels the selection
          attributes: (state) => (this.editor && this.editor.isEditable ? {} : { tabindex: '-1' }),
          // Keys typed before the content is loaded (read-only editor): kept, typed at the end of the content once loaded
          handleDOMEvents: {
            keydown: (view, event) => this.keepEarlyKey(event),
          },
        },
        onTransaction: () => this.keepUndoManagerTracking(),
        onUpdate: ({editor, transaction}) => {
          setTimeout(() => this.updateMatch(editor))
          // Unsaved changes of the page: changes of the user only
          if (this.initialeDataUpdated && this.isUserChange(transaction)) {
             this.emptyInitialValue = false
             this.$emit('editorchange')
          }
          if (this.noSync) return;
          this.updateHTML();
        },
        onSelectionUpdate: ({ editor }) => {
          setTimeout(() => this.updateMatch(editor))
        },
        disableInputRules: true,
        disablePasteRules: true,
      });

      // Bubble menus register their plugin after the creation: see editor-collaboration.js
      fixPluginRegistration(this.editor);

      // Review comments: highlighted passages and images
      this.editor.storage.commentHighlight.target = this.commentTarget;
      this.editor.storage.commentHighlight.store = this.commentsStore;
      this.updateCommentHighlights();
    },
    // The server refused the copy of this client: a field of the shared document was initialized again since from another
    // value of the database (document unloaded, then reopened by another user after a save). The copy and its changes
    // not synchronized are dropped and the shared document is loaded again, instead of being merged (duplicated content).
    async reloadSharedDocument() {
      await this.recreateEditor();
      if (!this.destroyed) Notify.create({ message: this.$t('editorDocumentReloaded'), color: 'warning', textColor: 'white', position: 'top-right' });
    },
    // New editor, Yjs document and connection (shared document reloaded, collaboration retried by the user)
    async recreateEditor() {
      if (this.destroyed) return;
      clearTimeout(this.unreachableTimer);
      this.destroyProvider();
      this.provider = null;
      this.editor.destroy();
      this.editor = null;
      Object.assign(this, { initialeDataUpdated: false, synced: false, status: 'connecting', emptyInitialValue: false, collabError: null, earlyText: '' });
      await this.$nextTick();
      if (this.destroyed) return;
      this.createEditor();
    },
    // Authentication refused by the collaboration server (rights, session): no endless retries of the provider, the
    // editor leaves the loading state, read-only (value of the page shown when the shared content was not loaded)
    stopCollaboration(reason) {
      clearTimeout(this.unreachableTimer);
      this.destroyProvider();
      this.provider = null;
      this.synced = false;
      this.collabError = { kind: 'unavailable', reason: reason || 'permission-denied' };
      this.editor.setEditable(false);
    },
    // Connection closed after removing the caret of the user (sent to the others before the connection is closed)
    destroyProvider() {
      if (!this.provider) return;
      this.provider.awareness.setLocalState(null);
      this.provider.destroy();
    },
    setInitialCollaborativeContent(value) {
      setInitialCollaborativeContent(this.editor, this.flattenCodeBlocks(this.htmlValue(value)));
    },
    // HTML of a value of the page: imported data can give another type to a rich text field (number, list, object),
    // shown as text
    htmlValue(value) {
      if (typeof value === 'string') return value;
      if (value === null || value === undefined) return '';
      const paragraph = document.createElement('p');
      paragraph.textContent = Array.isArray(value) ? value.join(', ') : (typeof value === 'object' ? JSON.stringify(value) : String(value));
      return paragraph.outerHTML;
    },
    // Images are stored by id: raw HTML shown with v-html needs their download URL
    withImageUrls(html) {
      return html.replace(/(<img\b[^>]*?\ssrc=")([^"]+)(")/g, (match, before, src, after) => before + Utils.normalizeImageUrl(src) + after);
    },
    // Initialization once the value of the page is loaded (loading prop) and, for the collaborative editors, the shared
    // document synchronized: its content is kept, or the last value of the page is written in the empty field.
    // Editable from then on.
    initialize() {
      if (this.destroyed || !this.editor || this.initialeDataUpdated || this.loading || !this.synced) return;
      clearTimeout(this.unreachableTimer);
      this.collabError = null;
      const value = this.modelValue;
      this.setInitialCollaborativeContent(value);
      this.emptyInitialValue = !value && this.editor.getHTML() === '<p></p>';
      this.initialeDataUpdated = true;
      this.editor.setEditable(this.canEdit);
      this.$emit('ready');
      if (this.earlyText) {
        // At the end of the last paragraph (as text, not HTML), in a new paragraph after a last image or table
        const { doc } = this.editor.state;
        const text = { type: 'text', text: this.earlyText };
        if (doc.lastChild.isTextblock) this.editor.commands.insertContentAt(doc.content.size - 1, text);
        else this.editor.commands.insertContentAt(doc.content.size, { type: 'paragraph', content: [text] });
        this.earlyText = '';
      }
    },
    keepEarlyKey(event) {
      if (this.initialeDataUpdated || !this.editable || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey)
        return false;
      this.earlyText += event.key;
      event.preventDefault();
      return true;
    },
    // Change of the document made by the user in this editor: not the initial content, the content received from the
    // collaboration (other users, synchronization) nor the update event of setEditable (document unchanged).
    // The undo / redo of the collaboration are changes of the user.
    isUserChange(transaction) {
      if (!transaction || !transaction.docChanged) return false;
      const sync = transaction.getMeta(ySyncPluginKey);
      return !(sync && sync.isChangeOrigin && !sync.isUndoRedoOperation);
    },
    keepUndoManagerTracking() {
      if (this.shared) keepUndoManagerTracking(this.editor);
    },
    acceptSuggestion(sug)  {
      this.editor.commands.insertContent(sug.value)
    },
    // LanguageTool menu: shown while the selected text is a reported mistake (not for any selected text)
    showLanguageToolMenu() {
      return Boolean(this.editor && this.editor.isEditable && this.editor.storage.languagetool.match.value);
    },
    // Proposes the selected word to ignore: ignored once approved by an administrator (at once for the administrators)
    proposeIgnoredWord() {
      const word = this.ignorableWord;
      if (!word) return;
      SpellcheckService.proposeWord(word)
        .then((response) => {
          const approved = response.data.datas.status === 'approved';
          if (approved) {
            SpellcheckService.clearCache();
            this.editor.commands.proofread(); // Mistakes of this word removed
          }
          this.editor.commands.setTextSelection(this.editor.state.selection.to); // Menu closed
          Notify.create({ message: this.$t(approved ? 'spellcheck.wordIgnored' : 'spellcheck.wordProposed', [word]), color: 'positive', textColor: 'white', position: 'top-right' });
        })
        .catch((err) => {
          Notify.create({ message: err.response?.data?.datas || err.message, color: 'negative', textColor: 'white', position: 'top-right' });
        });
    },
    updateMatch(editor) {


    },
    setLink(){
      const previousUrl = this.editor.getAttributes('link').href
      const url = window.prompt('URL', previousUrl)

      // cancelled
      if (url === null) {
        return
      }

      // empty
      if (url === '') {
        this.editor
          .chain()
          .focus()
          .extendMarkRange('link')
          .unsetLink()
          .run()

        return
      }

      // update link
      this.editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: url })
        .run()
    },
    // Image chosen in the toolbar: inserted where the cursor was when the file was chosen (not over the text selected
    // during the upload), failures notified
    importImage(files) {
      const file = files[0];
      if (file) uploadImageFile(this.editor.view, file, file.name);
    },
     stringToColour : function (str) {
      var hash = 0;
      for (var i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
      }
      var colour = '#';
      for (var i = 0; i < 3; i++) {
        var value = (hash >> (i * 8)) & 0xFF;
        colour += ('00' + value.toString(16)).substr(-2);
      }
      return colour;
    },
    // ----- Review comments -----

    updateCommentHighlights() {
      if (!this.editor || this.editor.isDestroyed) return;
      const tr = this.editor.state.tr.setMeta(commentHighlightKey, {
        comments: this.quoteComments,
        activeId: this.commentsStore ? this.commentsStore.activeId : null,
      });
      tr.setMeta('addToHistory', false);
      this.editor.view.dispatch(tr);
    },

    // Passage selected with the mouse or keyboard (also in read-only editors: reviewers comment without editing)
    checkCommentSelection() {
      this.commentSelection = null;
      if (!this.commentable || !this.editor) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const dom = this.editor.view.dom;
      if (!dom.contains(range.startContainer) || !dom.contains(range.endContainer)) return;
      let from, to;
      try {
        from = this.editor.view.posAtDOM(range.startContainer, range.startOffset);
        to = this.editor.view.posAtDOM(range.endContainer, range.endOffset);
      }
      catch (err) {
        return;
      }
      const quote = quoteFromRange(this.editor.state.doc, Math.min(from, to), Math.max(from, to));
      if (!quote) return;
      const rect = range.getBoundingClientRect();
      this.commentSelection = { quote, top: rect.top, left: rect.left + rect.width / 2 };
    },

    // Comment action of the formatting menu: passage selected in the editor
    commentSelectedText() {
      const { from, to } = this.editor.state.selection;
      const quote = quoteFromRange(this.editor.state.doc, from, to);
      if (!quote) return;
      this.commentsStore.startComment(this.commentTarget, quote);
      this.commentSelection = null;
    },

    commentOnSelection() {
      if (!this.commentSelection) return;
      this.commentsStore.startComment(this.commentTarget, this.commentSelection.quote);
      this.commentSelection = null;
      window.getSelection().removeAllRanges();
    },

    // Click on a highlighted passage: show its comment
    onContentClick(event) {
      const highlight = event.target instanceof Element ? event.target.closest('.comment-highlight') : null;
      if (highlight && this.commentsStore)
        this.commentsStore.show(highlight.dataset.commentId);
    },

    // Double click on an image of the editor or of the diff view: show it in a full screen dialog.
    // Listened on the content container because TipTap node views (uploadImage) stop events for ProseMirror.
    zoomImage(event) {
      if (!(event.target instanceof Element)) return;
      // q-img (uploadImage node view) puts a content layer over its <img>: look for the image in the q-img container
      const qImg = event.target.closest('.q-img');
      const candidates = qImg ? Array.from(qImg.querySelectorAll('img')) : [event.target.closest('img')];
      const img = candidates.find(i => i && i.complete && i.naturalWidth > 0); // Loaded images only
      if (!img) return;
      this.zoom = {show: true, src: img.currentSrc || img.src, alt: img.alt || '', fullSize: false};
    },
    // Code blocks are saved highlighted (<span class="hljs-..."> are used for colors in the report).
    // When parsing HTML, TipTap (elementFromString) removes text nodes equal to "\n" or "\n" + 2 spaces,
    // even inside <pre>: line breaks that lowlight isolates between two tokens were lost on reload
    // (e.g. between the request line and the first header of HTTP blocks, indentation in JSON/SQL).
    // Code blocks are flattened to plain text before being loaded in the editor (highlighting is redone).
    flattenCodeBlocks(html) {
      if (typeof html !== 'string' || !html.includes('<pre')) return html;

      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('pre code').forEach((codeBlock) => {
        codeBlock.textContent = codeBlock.textContent; // Replace highlighting spans by a single text node
      });
      return doc.body.innerHTML;
    },
    highlightAllCodeBlocks(html) {
      if (!html) return '';

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      doc.querySelectorAll('pre code').forEach((codeBlock) => {
        const langClass = codeBlock.className.match(/language-([a-zA-Z0-9-]+)/);
        const lang = langClass ? langClass[1] : 'plaintext';
        const originalCode = codeBlock.textContent;

        try {
          const highlighted = lowlight.highlight(lang, originalCode);
          const tempDiv = document.createElement('div');
          highlighted.children.forEach((node) => {
            tempDiv.appendChild(this.convertLowlightNodeToHtml(node));
          });
          codeBlock.innerHTML = tempDiv.innerHTML;
        } catch (e) {
          console.warn(`Highlighting failed for ${lang}, fallback to plaintext`, e);
          codeBlock.textContent = originalCode;
        }
      });

      return doc.body.innerHTML;
    },
    convertLowlightNodeToHtml(node) {
      if (node.type === 'text') {
        return document.createTextNode(node.value);
      } else if (node.type === 'element') {
        const el = document.createElement(node.tagName);
        if (node.properties) {
          Object.entries(node.properties).forEach(([key, value]) => {
            if (key === 'className') {
              el.className = value.join(' ');
            } else {
              el.setAttribute(key, value);
            }
          });
        }
        if (node.children) {
          node.children.forEach((child) => {
            el.appendChild(this.convertLowlightNodeToHtml(child));
          });
        }
        return el;
      }
      return document.createTextNode('');
    },
    updateHTML() {
      if (!this.initialeDataUpdated) return;
      // Editor initialized empty and not modified, value received since (e.g. default text of a custom field):
      // shown in the editor instead of being overwritten by the empty content of the editor
      if (this.emptyInitialValue && this.modelValue && this.editor.getHTML() === '<p></p>') {
        this.emptyInitialValue = false;
        this.setInitialCollaborativeContent(this.modelValue);
        return;
      }
      this.json = this.editor.getJSON();
      this.html = this.editor.getHTML();
      this.html = this.highlightAllCodeBlocks(this.html);
      if (
        Array.isArray(this.json.content) &&
        this.json.content.length === 1 &&
        !this.json.content[0].hasOwnProperty("content") &&
        !this.json.content[0].hasOwnProperty("attrs")
      ) {
        this.html = "";
      }
      this.$emit('update:modelValue', this.html);
    },
  },
});
</script>

<style lang="scss">

.tiptap {
  :first-child {
    margin-top: 0;
  }

  pre {
    background: var(--black);
    border-radius: 0.5rem;
    color: var(--white);
    font-family: 'JetBrainsMono', monospace;
    margin: 1.5rem 0;
    padding: 0.75rem 1rem;

    code {
      background: none;
      color: inherit;
      font-size: 0.8rem;
      padding: 0;
    }

    /* Code styling */
    .hljs-comment,
    .hljs-quote {
      color: #616161;
    }

    .hljs-variable,
    .hljs-template-variable,
    .hljs-attribute,
    .hljs-tag,
    .hljs-name,
    .hljs-regexp,
    .hljs-link,
    .hljs-name,
    .hljs-selector-id,
    .hljs-selector-class {
      color: #f98181;
    }

    .hljs-number,
    .hljs-meta,
    .hljs-built_in,
    .hljs-builtin-name,
    .hljs-literal,
    .hljs-type,
    .hljs-params {
      color: #fbbc88;
    }

    .hljs-string,
    .hljs-symbol,
    .hljs-bullet {
      color: #b9f18d;
    }

    .hljs-title,
    .hljs-section {
      color: #faf594;
    }

    .hljs-keyword,
    .hljs-selector-tag {
      color: #70cff8;
    }

    .hljs-emphasis {
      font-style: italic;
    }

    .hljs-strong {
      font-weight: 700;
    }
  }
}


.collaboration-carets__caret {
  position: relative;
  margin-left: -1px;
  margin-right: -1px;
  border-left: 1px solid #0D0D0D;
  border-right: 1px solid #0D0D0D;
  word-break: normal;
  pointer-events: none;
}

.collaboration-carets__label {
 text-shadow: -1px 0 black, 0 1px black, 1px 0 black, 0 -1px black;
 color:white;
  position: absolute;
  top: -1.4em;
  left: -1px;
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
  user-select: none;

  padding: 0.1rem 0.3rem;
  border-radius: 3px 3px 3px 0;
  white-space: nowrap;
}



.editor {
  :focus {
    outline: none;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  p,
  ul,
  ol,
  pre,
  blockquote {
    &:first-child {
      margin-top: 0;
    }

    &:last-child {
      margin-bottom: 0;
    }
  }

  .affix {
    width: auto;
    border-bottom: 1px solid rgba(0, 0, 0, 0.12);
    border-right: 1px solid rgba(0, 0, 0, 0.12);
    top: 50px !important;
    z-index: 1000;
  }
}

.editor {
  &__content {
    overflow-wrap: break-word;
    word-wrap: break-word;
    word-break: break-word;

    .ProseMirror {
      min-height: 200px;
      cursor: auto;
    }

    h1 {
      font-size: 4.25rem;
    }

    pre {
      padding: 0.7rem 1rem;
      border-radius: 5px;
      background: black;
      color: white;
      font-size: 0.8rem;
      overflow-x: auto;
      white-space: pre-wrap;

      code {
        display: block;
      }
    }

    p code {
      padding: 0.2rem 0.4rem;
      border-radius: 5px;
      font-size: 0.8rem;
      font-weight: bold;
      background: rgba(black, 0.1);
      color: rgba(black, 0.8);
    }

    ul,
    ol {
      padding-left: 1rem;
    }

    li > p,
    li > ol,
    li > ul {
      margin: 0;
    }

    a {
      color: inherit;
    }

    blockquote {
      border-left: 3px solid rgba(black, 0.1);
      color: rgba(black, 0.8);
      padding-left: 0.8rem;
      font-style: italic;

      p {
        margin: 0;
      }
    }

    img {
      max-width: 100%;
      border-radius: 3px;
    }

    .selected {
      outline-style: solid;
      outline-color: $blue-4;
    }

    table {
      border-collapse: collapse;
      table-layout: fixed;
      width: 100%;
      margin: 0;
      overflow: hidden;

      td,
      th {
        min-width: 1em;
        border: 2px solid grey;
        padding: 3px 5px;
        vertical-align: top;
        box-sizing: border-box;
        position: relative;
        > * {
          margin-bottom: 0;
        }
      }

      th {
        background-color: #f1f3f5;
        font-weight: bold;
        text-align: left;
      }

      .selectedCell:after {
        z-index: 2;
        position: absolute;
        content: "";
        left: 0;
        right: 0;
        top: 0;
        bottom: 0;
        background: rgba(200, 200, 255, 0.4);
        pointer-events: none;
      }

      .column-resize-handle {
        position: absolute;
        right: -2px;
        top: 0;
        bottom: 0;
        width: 4px;
        z-index: 20;
        background-color: #adf;
        pointer-events: none;
      }
    }

    .tableWrapper {
      margin: 1em 0;
      overflow-x: auto;
    }

    .resize-cursor {
      cursor: ew-resize;
      cursor: col-resize;
    }
  }
}
.is-active {
  color: green;
}
.editor-toolbar {
  min-height: 32px;
}

.diffrem {
  background-color: #fdb8c0;
}
pre .diffrem {
  background-color: $red-6;
}

.diffadd {
  background-color: #acf2bd;
}
pre .diffadd {
  background-color: $green-6;
}

.editor-bubble-menu{
   background: #333333;
    color: white;
    border-radius: 8px;
    padding: 5px;
    margin: -5px;
    display: flex;
}

.editor-bubble-menu > button > i{
  border-radius: 5px;
  width: 24px;
  height: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #ffffff;
}

.editor-bubble-menu > button > i:hover{
        background: #555555;
        color: #ffffff;
        cursor: pointer;
}
.editor-bubble-menu > .is-active > i {
        background: #555555;
        color: #ffffff;
        cursor: pointer;
}
.editor-bubble-menu > button {
  background: bottom;
    border: none;
}

/* Comment action of the selection menu: separated from the formatting actions */
.editor-bubble-menu > .editor-bubble-menu__comment {
  border-left: 1px solid #555555;
  margin-left: 3px;
  padding-left: 6px;
}

.editor-bubble-menu > .editor-bubble-menu__comment > i {
  color: #ffb74d;
}

.editor-menubar {
  display: flex;
  gap: 1rem;

  button {
    padding: 0.5rem;
    text-transform: capitalize;
    border: none;
    background-color: white;
    box-shadow: 0 0 10px rgba($color: #000000, $alpha: 0.25);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    font-weight: 500;
    font-size: 1.1em;

    &:hover {
      box-shadow: 0 0 2px rgba($color: #000000, $alpha: 0.25);
    }
  }
}

.ProseMirror {
  .lt {
    border-bottom: 2px solid #e86a69;
    transition: background 0.25s ease-in-out;

    &:hover {
      background: rgba($color: #e86a69, $alpha: 0.2);
    }

    &-style {
      border-bottom: 2px solid #9d8eff;

      &:hover {
        background: rgba($color: #9d8eff, $alpha: 0.2) !important;
      }
    }

    &-typographical,
    &-grammar {
      border-bottom: 2px solid #eeb55c;

      &:hover {
        background: rgba($color: #eeb55c, $alpha: 0.2) !important;
      }
    }

    &-misspelling {
      border-bottom: 2px solid #e86a69;

      &:hover {
        background: rgba($color: #e86a69, $alpha: 0.2) !important;
      }
    }
  }

  &-focused {
    outline: none !important;
  }
}


.content {
  max-width: 50%;
  min-width: 50%;
}

.bubble-menu > .bubble-menu-section-container {
  display: flex;
  flex-direction: column;
  background-color: white;
  padding: 8px;
  border-radius: 8px;
  box-shadow: 0 0 10px rgba($color: black, $alpha: 0.25);
  max-width: 400px;

  .suggestions-section {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 1em;

    .suggestion {
      background-color: #229afe;
      border-radius: 4px;
      color: white;
      cursor: pointer;
      font-weight: 500;
      padding: 4px;
      display: flex;
      align-items: center;
      font-size: 1.1em;
      max-width: fit-content;
    }
  }

  .ignore-section {
    margin-top: 8px;

    .suggestion--ignore {
      background-color: transparent;
      color: #455a64;
      border: 1px solid #b0bec5;
      font-size: 0.95em;
      font-weight: 400;
    }
  }
}

// Review comments: highlighted passages and selection button
.comment-highlight {
  background: rgba(255, 193, 7, 0.3);
  border-bottom: 2px solid #ffa000;
  cursor: pointer;
}

.comment-highlight--active {
  background: rgba(255, 152, 0, 0.55);
}

.comment-image-highlight .editor-image {
  outline: 3px solid rgba(255, 160, 0, 0.7);
  outline-offset: 2px;
}

.comment-image-highlight--active .editor-image {
  outline-color: #ff6d00;
}

.comment-selection-btn {
  position: fixed;
  z-index: 3000;
  transform: translateX(-50%);
}

// Images can be zoomed with a double click
.editor__content img,
.editor__content .q-img {
  cursor: zoom-in;
}

// Image zoom dialog (teleported to body: not scoped)
.editor-image-zoom {
  width: 100vw;
  height: 100vh;
  overflow: auto;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  img {
    max-width: 95vw;
    max-height: 90vh;
    object-fit: contain;
    background: white;
    cursor: zoom-in;
  }

  // Actual size: start from top left so that the scrollable area is not cut by centering
  &--full {
    align-items: flex-start;
    justify-content: flex-start;

    img {
      max-width: none;
      max-height: none;
      cursor: zoom-out;
    }
  }

  &__close {
    position: fixed;
    top: 8px;
    right: 8px;
    z-index: 1;
    background: rgba(0, 0, 0, 0.4);
  }

  &__caption {
    color: white;
    padding: 8px;
  }
}

</style>
