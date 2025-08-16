<template>
  <q-card
    v-if="editor"
    flat
    bordered
    class="editor full-width"
    :class="affixRelativeElement"
    :style="editable ? '' : 'border: 1px dashed lightgrey'"
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
            :disabled="!editor.isActive('link') "
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
          <q-btn flat size="sm" dense
                 :class="{ 'is-active': editor.isActive('code') }"
                 @click="editor.chain().focus().toggleCode().run()"
          >
            <q-tooltip :delay="500" content-class="text-bold">Code</q-tooltip>
            <q-icon name="code" />
          </q-btn>

          <q-btn flat size="sm" dense
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
              @click="editor.chain().focus().deleteRow().run()" :disabled="!editor.can().deleteRow()"
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
              @click="editor.chain().focus().deleteColumn().run()" :disabled="!editor.can().deleteColumn()"
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
            :disabled="!editor.can().deleteTable()"
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
          <q-btn flat size="sm" dense>
            <label class="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                class="hidden"
                @change="importImage($event.target.files)"
                :disabled="!editable"
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
          <q-btn-dropdown flat size="sm" dense icon="subtitles">
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
          flat
          size="sm"
          dense
          @click="editor.chain().focus().undo().run()"
        >
          <q-tooltip :delay="500" content-class="text-bold">Undo</q-tooltip>
          <q-icon name="undo" />
        </q-btn>

        <q-btn
          flat
          size="sm"
          dense
          @click="editor.chain().focus().redo().run()"
        >
          <q-tooltip :delay="500" content-class="text-bold">Redo</q-tooltip>
          <q-icon name="redo" />
        </q-btn>

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
     <bubble-menu
      class="editor-bubble-menu"
      :editor="editor"
      :tippy-options="{ duration: 100 }"
      v-if="editor"
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


    </bubble-menu>
    <bubble-menu
  class="bubble-menu"
  v-if="editor"
  :editor="editor"
  :tippy-options="{ placement: 'bottom', animation: 'fade' }"
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
  </section>
</bubble-menu>
    <editor-content
      v-if="typeof diff === 'undefined' || !toggleDiff"
      class="editor__content q-pa-sm"
      :editor="editor"
    />
    <div v-else class="editor__content q-pa-sm">
      <div class="ProseMirror" v-html="diffContent"></div>
    </div>
  </q-card>
</template>

<script>
import { defineComponent,ref } from 'vue';

import { Editor, EditorContent, BubbleMenu, VueNodeViewRenderer  } from "@tiptap/vue-3";
//  Import extensions
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'


import { LanguageTool } from './languagetool'
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import Link from "@tiptap/extension-link";
import CustomImage from "./editor-image";
//import Caption from "./editor-caption";
import { Figure } from "./figure";
import { TriggerMenuExtension } from './internal-link';
import {v4 as uuidv4} from 'uuid';
import UserService from '@/services/user';
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'



import css from 'highlight.js/lib/languages/css'
import js from 'highlight.js/lib/languages/javascript'
import http from 'highlight.js/lib/languages/http'
import ts from 'highlight.js/lib/languages/typescript'
import html from 'highlight.js/lib/languages/xml'
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import CodeBlockComponent from './CodeBlockComponent.vue'

import { all, createLowlight } from 'lowlight'

// create a lowlight instance
const lowlight = createLowlight(all)

// you can also register languages
lowlight.register('html', html)
lowlight.register('css', css)
lowlight.register('javascripts', js)
lowlight.register('ts', ts)
lowlight.register('http', http)
lowlight.register('bash', bash);
lowlight.register('sql', sql);
lowlight.register('json', json);


const Diff = require("diff");
//  Internal libs
import Utils from "@/services/utils";
import ImageService from "@/services/image";


const match = ref(null)


const updateHtmlLanguageTool = () => navigator.clipboard.writeText(editor.value.getHTML())


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

  },

  components: {
    EditorContent,
    BubbleMenu
  },

  data() {
    return {
      editor: null,
      json: "",
      html: "",
      toggleDiff: true,
      affixRelativeElement: "affix-relative-element",
      status: 'connecting',
      state:false,
      fullId:"",
      countChange:0,
      countChangeAfterUpdate:-1,
      initialeDataUpdated:false,
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
    async modelValue(value) {
      await this.updateInitialeValue(value)
    },
    editable(value) {
      //this.editor.setOptions({ editable: this.editable });
      this.editor.setEditable(this.editable && this.initialeDataUpdated);
    },
  },

  mounted() {

    const updateMatch = this.updateMatch;



    const proofread = () => this.editor.commands.proofread()



    if (this.modelValue === undefined || this.modelValue === null) {
      this.$emit('update:modelValue', '');
    }
     const ydoc = new Y.Doc()
     if(this.idUnique == '') {
      this.ClassEditor = uuidv4()
     } else {
      this.ClassEditor = this.idUnique
     }
     this.username = UserService.user.username
     if (typeof this.$route.params.findingId == 'undefined'){
        this.fullId=this.ClassEditor
     } else {
        this.fullId= this.$route.params.auditId+'-'+this.$route.params.findingId+'-'+this.ClassEditor
     }

    let extensionEditor = [
        StarterKit.configure({
          codeBlock: false, // Désactive le codeBlock standard pour mettre le code block highlight
        }),

        Highlight.configure({
          multicolor: true,
        }),
        Link.configure({
          protocols: ['ftp', 'mailto'],
             linkOnPaste: false,
              openOnClick: false,
        }),
        CodeBlockLowlight
          .extend({
            addNodeView() {
              return VueNodeViewRenderer(CodeBlockComponent)
            },
          })
          .configure({ lowlight }),
        Underline,
        Table.configure({
          resizable: true,
        }),
        TableRow,
        TableHeader,
        TableCell,
        TriggerMenuExtension,
        CustomImage.configure({
          HTMLAttributes: {
            class: "custom-image",
          },
          allowBase64: true
        }),
        Figure,
        LanguageTool.configure({
         apiUrl: `https://${window.location.hostname}${window.location.port != '' ? ':'+window.location.port : ''}/v2/check`, 
          //apiUrl: `https://127.0.0.1:8443/v2/check`, 
          language: 'auto',   
          automaticMode: true, // 1 seconde de délai avant vérification
        }),
      ]
     if(this.collab){

       this.provider = new HocuspocusProvider({
        url: `wss://${window.location.hostname}${window.location.port != '' ? ':'+window.location.port : ''}/collab/`,
        //url:"wss://127.0.0.1:8443/collab/",
        name: this.$route.params.auditId ||  this.idUnique.replace('-', '/'),
        document  : ydoc
      })

      this.provider.on('status', event => {
        this.status = event.status
        console.log('status',event.status)
      })
      this.provider.on('synced', state => {
        this.state=state.state
        console.log('ok',state.state)
      })
      extensionEditor.push(Collaboration.configure({
          document: ydoc,
          field: this.fullId
      }))
      extensionEditor.push(CollaborationCursor.configure({
          provider: this.provider,
          user: {
            name:  this.username,
            color:  this.stringToColour(this.username)
          }
      }))

    } else {
      this.state=true
      this.status = 'connected'

    }

    this.editor = new Editor({
      editable: false,
      extensions: extensionEditor ,
      onUpdate: ({editor}) => {
        setTimeout(() => updateMatch(editor))
        if(this.state && this.initialeDataUpdated && this.countChangeAfterUpdate>0 && this.countChangeAfterUpdate<this.countChange){
           this.$emit('editorchange') // need save only if sync is done
        } else {
          this.countChange++
        }
        if (this.noSync) return;
        this.updateHTML();
      },
      onSelectionUpdate({ editor }) {
        setTimeout(() => updateMatch(editor))
      },
      disableInputRules: true,
      disablePasteRules: true,
    });

    this.affixRelativeElement += "-" +  this.ClassEditor;
    //this.editor.setOptions({ editable: this.editable });
    this.editor.setEditable(this.editable && this.initialeDataUpdated);
    
    if (typeof this.modelValue === "undefined") {
      this.$emit('update:modelValue', "");
    }

    if (
      this.modelValue === this.editor.getHTML()
    ) {
      return;
    }
    this.updateInitialeValue(this.modelValue)

  },

  async beforeUnmount() {
    while(1){
      if(this.state==1 && this.status=='connected') break;
      else await this.sleep(100)
    }
    if(this.collab){
      this.provider.destroy()
    }
    this.editor.destroy();
  },

  computed: {

    match() {
      return this.editor ? this.editor.extensionStorage.languagetool.match.value : null;
    },
    matchMessage() {
     // console.log('matchmessage',this.match.message,this.match)
      return this.match?.message || 'No Message';
    },
    replacements() {
      //console.log('remplacements',this.match.replacements,this.match)
      return this.match?.replacements || [];
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
        var value = this.modelValue || "";
        var diff = HtmlDiff.diff(this.diff, value);
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
      return content;
    },
  },

  methods: {
    acceptSuggestion(sug)  {
      this.editor.commands.insertContent(sug.value)
    },
    updateMatch(editor) {


    },
    async updateInitialeValue(value){

              
    if( typeof this.$route.params.auditId == 'undefined' && (this.idUnique.split('-')[0]=="undefined" || this.idUnique.split('-') == ""  )&& this.initialeDataUpdated==false){
      // if editor is init not in vuln edit context like cutom field
      this.editor.commands.setContent(value, false);
      this.initialeDataUpdated=true
      this.editor.setEditable(this.editable && this.initialeDataUpdated);
      this.$emit('ready')
      this.countChangeAfterUpdate=this.countChange
    } else {

      if(this.initialeDataUpdated==false){
          for (let i = 0; i < 200; i++) { // 25 second to connect web socket failed after
            if(this.status=='connected' && this.state){
              if(this.editor.getHTML() != value && this.editor.getHTML()=='<p></p>'){
                this.editor.commands.setContent(value, false);
              }
              this.initialeDataUpdated=true
              this.editor.setEditable(this.editable && this.initialeDataUpdated);
              this.$emit('ready')
              this.countChangeAfterUpdate=this.countChange
              break;
            } else {
              await this.sleep(500)
              console.log('Wait websocket')
            }
          }
        }
      } 
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
    sleep(milliseconds) {
      return new Promise((resolve) => setTimeout(resolve, milliseconds));
    },
    importImage(files) {
      var file = files[0];
      var fileReader = new FileReader();

      var auditId = null;
      var path = window.location.pathname.split("/");
      if (path && path.length > 3 && path[1] === "audits") auditId = path[2];
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
            this.editor.commands.setImage({
              src: data.data.datas._id,
              alt: file.name,
            });
          })
          .catch((err) => console.log(err));
      };

      fileReader.readAsDataURL(file);
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


.collaboration-cursor__caret {
  position: relative;
  margin-left: -1px;
  margin-right: -1px;
  border-left: 1px solid #0D0D0D;
  border-right: 1px solid #0D0D0D;
  word-break: normal;
  pointer-events: none;
}

.collaboration-cursor__label {
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
}

</style>
