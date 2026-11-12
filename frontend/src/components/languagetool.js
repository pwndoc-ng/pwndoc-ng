import { Extension } from '@tiptap/core'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Mapping } from '@tiptap/pm/transform'
import { debounce } from 'lodash'
import { v4 as uuidv4 } from 'uuid'
import { ref } from 'vue';
//this pluguin is based on https://github.com/sereneinserenade/tiptap-languagetool/ integration
export var LanguageToolHelpingWords
;(function (LanguageToolHelpingWords) {
  LanguageToolHelpingWords['LanguageToolTransactionName'] = 'languageToolTransaction'
  LanguageToolHelpingWords['MatchUpdatedTransactionName'] = 'matchUpdated'
  LanguageToolHelpingWords['LoadingTransactionName'] = 'languageToolLoading'
})(LanguageToolHelpingWords || (LanguageToolHelpingWords = {}))

// Utility function for text selection
const selectElementText = (el) => {
  const range = document.createRange()
  range.selectNode(el)
  const sel = window.getSelection()
  sel === null || sel === void 0 ? void 0 : sel.removeAllRanges()
  sel === null || sel === void 0 ? void 0 : sel.addRange(range)
}

// Request cache to avoid checking the same text multiple times
const requestCache = new Map();
const MAX_CACHE_SIZE = 100;

// Function to check if text is in cache
const getCachedResponse = (text) => {
  return requestCache.get(text);
};

// Function to add response to cache
const addToCache = (text, response) => {
  // Limit cache size
  if (requestCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry
    const firstKey = requestCache.keys().next().value;
    requestCache.delete(firstKey);
  }
  requestCache.set(text, response);
};

export function changedDescendants(old, cur, offset, f) {
  const oldSize = old.childCount,
    curSize = cur.childCount
  outer: for (let i = 0, j = 0; i < curSize; i++) {
    const child = cur.child(i)
    for (let scan = j, e = Math.min(oldSize, i + 3); scan < e; scan++) {
      if (old.child(scan) === child) {
        j = scan + 1
        offset += child.nodeSize
        continue outer
      }
    }
    f(child, offset, cur)
    if (j < oldSize && old.child(j).sameMarkup(child)) changedDescendants(old.child(j), child, offset + 1, f)
    else child.nodesBetween(0, child.content.size, f, offset + 1)
    offset += child.nodeSize
  }
}

// Decoration of a match: the match is kept in its spec (suggestion menu of the selected match)
const gimmeDecoration = (from, to, match) =>
  Decoration.inline(from, to, {
    class: `lt lt-${match.rule.issueType}`,
    nodeName: 'span',
    'data-match': JSON.stringify(match),
    uuid: uuidv4(),
  }, { match })

// Match of a selection (suggestion menu): text selected inside a decorated match, null otherwise (empty selection, text
// without match, selection larger than the match)
export const selectionMatch = (decorationSet, selection) => {
  if (!decorationSet || selection.empty) return null
  const decoration = decorationSet.find(selection.from, selection.to)
    .find((deco) => deco.spec.match && deco.from <= selection.from && deco.to >= selection.to)
  return decoration ? decoration.spec.match : null
}

const moreThan500Words = (s) => s.trim().split(/\s+/).length >= 500

// Registry of active editor instances
const activeEditors = new Set();

export const LanguageTool = Extension.create({
  name: 'languagetool',
  
  addOptions() {
    return {
      language: 'auto',
      apiUrl:'http://127.0.0.1:8010/v2/check',
      automaticMode: true,
      // Words not reported (approved words ignored by the spell checker): function returning them in lower case (array, or
      // promise of an array)
      ignoredWords: () => [],
      // Parameters for optimization (reduced to ensure triggering)
      debounceDelay: 800,         // Shorter debounce delay
      minTextLengthForCheck: 3,   // Very low minimum text threshold
      checkThrottle: 1000,        // Minimum time between checks
    }
  },
  
  addStorage() {
    return {
      match: ref(null),
      loading: ref(false),
      editorView: null,
      apiUrl: null,
      decorationSet: null,
      textNodesWithPosition: [],
      proofReadInitially: false,
      editorId: uuidv4(),          // Unique ID for each editor instance
      lastCheckTime: 0,            // Timestamp of last check
      pendingCheck: false,         // Indicates if a check is pending
      currentDecoElements: new Set(), // Current decoration elements for cleanup
    }
  },
  
  addCommands() {
    return {
      proofread: () => ({ tr }) => {
        const storage = this.storage;
        storage.proofreadAndDecorateWholeDoc(tr.doc);
        return true;
      },
      toggleProofreading: () => () => {
        // TODO: implement toggling proofreading
        return false;
      },
    }
  },
  
  onBeforeCreate() {
    // Initialisation avec les valeurs des options
    const storage = this.storage;
    storage.apiUrl = this.options.apiUrl;

    // Ignored words in lower case (none if they cannot be loaded)
    const ignoredWords = this.options.ignoredWords;
    storage.ignoredWords = async () => {
      try {
        return new Set(await ignoredWords());
      } catch (error) {
        return new Set();
      }
    };
    // Matches to show: matches whose text is not an ignored word
    storage.reportedMatches = async (doc, matches, offset) => {
      const ignored = await storage.ignoredWords();
      return matches
        .map((match) => ({ from: match.offset + offset, to: match.offset + offset + match.length, match }))
        .filter(({ from, to }) => !ignored.has(doc.textBetween(from, to).toLowerCase()));
    };
    
    // Move cleanupEventListeners to storage
    storage.cleanupEventListeners = () => {
      if (storage.currentDecoElements.size > 0) {
        storage.currentDecoElements.forEach(el => {
          if (el._mouseEnterListener) {
            el.removeEventListener('click', el._mouseEnterListener);
          }
        });
        storage.currentDecoElements.clear();
      }
    };
  },
  
  onDestroy() {
    // Cleanup when extension is destroyed
    const storage = this.storage;
    activeEditors.delete(storage.editorId);
    
    // Clean up event listeners
    if (storage.cleanupEventListeners) {
      storage.cleanupEventListeners();
    }
  },
  
  addProseMirrorPlugins() {
    const { apiUrl, automaticMode, debounceDelay, minTextLengthForCheck, checkThrottle } = this.options;
    const storage = this.storage;
    
    // Add editor to active instances registry
    activeEditors.add(storage.editorId);

    // Changes of the document made during the requests (text typed meanwhile): the matches, computed on the text sent, are
    // mapped to the current document
    storage.pendingMappings = new Set();
    storage.trackChanges = () => {
      const mapping = new Mapping();
      storage.pendingMappings.add(mapping);
      return mapping;
    };
    // Decorations of the matches in the current document; a match whose text changed meanwhile is dropped
    storage.mappedDecorations = (requestDoc, matches, mapping) => {
      const doc = storage.editorView.state.doc;
      return matches.flatMap(({ from, to, match }) => {
        const mappedFrom = mapping.map(from, 1);
        const mappedTo = mapping.map(to, -1);
        if (mappedTo <= mappedFrom || doc.textBetween(mappedFrom, mappedTo, ' ') !== requestDoc.textBetween(from, to, ' ')) return [];
        return [gimmeDecoration(mappedFrom, mappedTo, match)];
      });
    };
    
    // Optimized dispatch function
    storage.dispatch = (tr) => {
      if (storage.editorView) {
        storage.editorView.dispatch(tr);
      }
    };
    
    // Optimized event listener management
    storage.addEventListenersToDecorations = () => {
      if (!storage.editorView) return;
      
      // Clean up old listeners first
      storage.cleanupEventListeners();
      
      // Decorations of this editor only (other editors on the page have their own match)
      const decos = storage.editorView.dom.querySelectorAll('span.lt');
      if (!decos.length) return;
      
      decos.forEach((el) => {
        // Click on a match: its text selected in the editor, which shows the suggestion menu of the match
        const mouseEnterListener = (e) => {
          if (!e.target || !storage.editorView) return;
          selectElementText(e.target);
          const view = storage.editorView;
          const from = view.posAtDOM(e.target, 0);
          const to = from + e.target.textContent.length;
          if (from >= 0 && to <= view.state.doc.content.size)
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
        };
        
        // Store references to clean them up later
        el._mouseEnterListener = mouseEnterListener;
        
        el.addEventListener('click', mouseEnterListener);
        
        // Add to current elements set
        storage.currentDecoElements.add(el);
      });
    };
    
    // Optimized function to check a text node
    storage.proofreadNodeAndUpdateItsDecorations = async (node, offset) => {
      if (!storage.editorView?.state || !node.textContent) return;
      
      // Check if auto correction is enabled
      const autoCorrectionEnabled = sessionStorage.getItem('autoCorrectionEnabled');
      if (autoCorrectionEnabled === 'false') {
        // If disabled, remove existing decorations and exit
        if (storage.decorationSet) {
          storage.decorationSet = storage.decorationSet.remove(storage.decorationSet.find(offset, offset + node.nodeSize));
        }
        return;
      }
      
      storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LoadingTransactionName, true));
      const requestDoc = storage.editorView.state.doc;
      const mapping = storage.trackChanges();
      try {
      
        // Check cache first
        let ltRes = getCachedResponse(node.textContent);
      
        if (!ltRes) {
          try {
            const response = await fetch(storage.apiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
              },
              body: `text=${encodeURIComponent(node.textContent)}&language=auto&enabledOnly=false`,
            });
            // Error answer (text too long, server error): no match to show, not cached
            if (!response.ok) throw new Error(`LanguageTool answered ${response.status}`);
            ltRes = await response.json();
            addToCache(node.textContent, ltRes);
          } catch (error) {
            console.error('LanguageTool request failed:', error);
            storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LoadingTransactionName, false));
            return;
          }
        }
      
        if (!storage.editorView) return; // In case the editor was destroyed in the meantime
      
        const nodeMatches = await storage.reportedMatches(requestDoc, ltRes.matches, offset);
      
        if (!storage.editorView) return; // Check again if the editor still exists
      
        storage.decorationSet = storage.decorationSet.remove(storage.decorationSet.find(mapping.map(offset, -1), mapping.map(offset + node.nodeSize, 1)));
        storage.decorationSet = storage.decorationSet.add(storage.editorView.state.doc, storage.mappedDecorations(requestDoc, nodeMatches, mapping));
        storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LanguageToolTransactionName, true));
        storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LoadingTransactionName, false));
      
        // Add event listeners to decorations
        setTimeout(() => storage.addEventListenersToDecorations(), 0);
      } finally {
        storage.pendingMappings.delete(mapping);
      }
    };
    
    // Function to clean all LanguageTool decorations
    storage.clearAllDecorations = () => {
      if (storage.decorationSet && storage.editorView) {
        storage.decorationSet = DecorationSet.empty;
        storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LanguageToolTransactionName, true));
      }
    };

    // Function to update LanguageTool state based on toggle
    storage.updateLanguageToolState = () => {
      const autoCorrectionEnabled = sessionStorage.getItem('autoCorrectionEnabled');
      if (autoCorrectionEnabled === 'false') {
        storage.clearAllDecorations();
      } else {
        // If reactivated, restart verification on current document
        if (storage.editorView && storage.editorView.state) {
          storage.proofreadAndDecorateWholeDoc(storage.editorView.state.doc);
        }
      }
    };

    // Optimized function to check entire document
    storage.proofreadAndDecorateWholeDoc = async (doc) => {
      if (!doc || !storage.editorView) return;
      
      // Check if auto correction is enabled
      const autoCorrectionEnabled = sessionStorage.getItem('autoCorrectionEnabled');
      if (autoCorrectionEnabled === 'false') {
        // If disabled, remove all existing decorations and exit
        storage.clearAllDecorations();
        return;
      }
      
      storage.textNodesWithPosition = [];
      let index = 0;
      
      // Collect all text nodes
      doc.descendants((node, pos) => {
        if (node.isText) {
          if (storage.textNodesWithPosition[index]) {
            const text = storage.textNodesWithPosition[index].text + node.text;
            const from = storage.textNodesWithPosition[index].from;
            const to = from + text.length;
            storage.textNodesWithPosition[index] = { text, from, to };
          } else {
            const text = node.text || "";
            const from = pos;
            const to = pos + text.length;
            storage.textNodesWithPosition[index] = { text, from, to };
          }
        } else {
          index += 1;
        }
      });
      
      storage.textNodesWithPosition = storage.textNodesWithPosition.filter(Boolean);
      
      // If no text to check, exit
      if (storage.textNodesWithPosition.length === 0) return;
      
      // Split into chunks to avoid overloading the API
      let finalText = '';
      const chunksOf500Words = [];
      let upperFrom = 0;
      let newDataSet = true;
      let lastPos = 1;
      
      for (const { text, from, to } of storage.textNodesWithPosition) {
        if (!newDataSet) {
          upperFrom = from;
          newDataSet = true;
        } else {
          const diff = from - lastPos;
          if (diff > 0) finalText += Array(diff + 1).join(' ');
        }
        
        lastPos = to;
        finalText += text;
        
        if (moreThan500Words(finalText)) {
          const updatedFrom = chunksOf500Words.length ? upperFrom : upperFrom + 1;
          chunksOf500Words.push({
            from: updatedFrom,
            text: finalText,
          });
          finalText = '';
          newDataSet = false;
        }
      }
      
      if (finalText) {
        chunksOf500Words.push({
          from: chunksOf500Words.length ? upperFrom : 1,
          text: finalText,
        });
      }
      
      // No chunk to verify
      if (chunksOf500Words.length === 0) return;
      
      // Indicate loading
      storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LoadingTransactionName, true));
      const mapping = storage.trackChanges();
      
      // Optimized function to check a text chunk
      const getMatchAndSetDecorations = async (doc, text, originalFrom) => {
        if (!text || !storage.editorView) return;
        
        // Check cache first
        let ltRes = getCachedResponse(text);
        
        if (!ltRes) {
          try {
            const response = await fetch(storage.apiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
              },
              body: `text=${encodeURIComponent(text)}&language=auto&enabledOnly=false`,
            });
            // Error answer (text too long, server error): no match to show, not cached
            if (!response.ok) throw new Error(`LanguageTool answered ${response.status}`);
            ltRes = await response.json();
            addToCache(text, ltRes);
          } catch (error) {
            console.error('LanguageTool request failed:', error);
            return;
          }
        }
        
        if (!storage.editorView) return; // In case the editor was destroyed in the meantime
        
        const chunkMatches = await storage.reportedMatches(doc, ltRes.matches, originalFrom);
        
        if (!storage.editorView) return; // Check again if editor still exists
        
        storage.decorationSet = storage.decorationSet.remove(storage.decorationSet.find(mapping.map(originalFrom, -1), mapping.map(originalFrom + text.length, 1)));
        storage.decorationSet = storage.decorationSet.add(storage.editorView.state.doc, storage.mappedDecorations(doc, chunkMatches, mapping));
        
        if (storage.editorView) {
          storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LanguageToolTransactionName, true));
        }
      };
      
      // Process all chunks in parallel rather than sequentially to reduce load
      try {
        await Promise.all(chunksOf500Words.map(async ({ text, from }) => {
          await getMatchAndSetDecorations(doc, text, from);
        }));
      } finally {
        storage.pendingMappings.delete(mapping);
      }
      
      if (storage.editorView) {
        storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LoadingTransactionName, false));
        storage.proofReadInitially = true;
        
        // Add event listeners to decorations
        setTimeout(() => storage.addEventListenersToDecorations(), 0);
      }
    };
    
    // Create debounced versions of methods
    storage.debouncedProofreadNodeAndUpdateItsDecorations = debounce(
      (node, offset) => {
        storage.proofreadNodeAndUpdateItsDecorations(node, offset);
      }, 
      debounceDelay
    );
    
    storage.debouncedProofreadAndDecorate = debounce(
      (doc) => {
        storage.proofreadAndDecorateWholeDoc(doc);
      }, 
      debounceDelay
    );
    
    return [
      new Plugin({
        key: new PluginKey(`languagetool-${storage.editorId}`), // Unique key per instance
        props: {
          decorations(state) {
            return this.getState(state);
          },
          attributes: {
            spellcheck: 'false',
          },
        },
        state: {
          init: (config, state) => {
            // Initialiser decorationSet dans le storage
            storage.decorationSet = DecorationSet.create(state.doc, []);
            return storage.decorationSet;
          },
          apply: (tr, oldPluginState, oldEditorState) => {
            if (tr.docChanged) storage.pendingMappings.forEach((mapping) => mapping.appendMapping(tr.mapping));
            const loading = tr.getMeta(LanguageToolHelpingWords.LoadingTransactionName);
            
            if (loading !== undefined) {
              storage.loading.value = loading;
            }
            
            const languageToolDecorations = tr.getMeta(LanguageToolHelpingWords.LanguageToolTransactionName);
            if (languageToolDecorations) {
              storage.match.value = selectionMatch(storage.decorationSet, tr.selection);
              return storage.decorationSet;
            }
            
            // Check document changes
            if (tr.docChanged && automaticMode && storage.editorView) {
              if (!storage.proofReadInitially) {
                storage.debouncedProofreadAndDecorate(tr.doc);
              } else {
                // Check only modified parts
                changedDescendants(
                  oldEditorState.doc, 
                  tr.doc, 
                  0, 
                  storage.debouncedProofreadNodeAndUpdateItsDecorations
                );
              }
            }
            
            // Update decorations based on document changes
            storage.decorationSet = storage.decorationSet.map(tr.mapping, tr.doc);
            // Match of the selection: suggestion menu shown while text of a match is selected
            storage.match.value = selectionMatch(storage.decorationSet, tr.selection);
            
            return storage.decorationSet;
          },
        },
        view: (view) => {
          // Store editor in storage
          storage.editorView = view;
          
          // Initialize verification immediately on load if auto mode is enabled
          if (automaticMode) {
            // Short delay to let the editor initialize completely
            setTimeout(() => {
              if (storage.editorView) {
                storage.proofreadAndDecorateWholeDoc(view.state.doc);
              }
            }, 500);
          }
          
          return {
            update(view) {
              storage.editorView = view;
            },
            destroy: () => {
              // Nettoyer lors de la destruction
              activeEditors.delete(storage.editorId);
              if (storage.cleanupEventListeners) {
                storage.cleanupEventListeners();
              }
              storage.editorView = null;
            }
          };
        },
      }),
    ];
  },
})
