import { Extension } from '@tiptap/core'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { Plugin, PluginKey } from 'prosemirror-state'
import { debounce } from 'lodash'
import { v4 as uuidv4 } from 'uuid'
import { Dexie } from 'dexie'
import { ref } from 'vue';
//this pluguin is based on https://github.com/sereneinserenade/tiptap-languagetool/ integration
export var LanguageToolHelpingWords
;(function (LanguageToolHelpingWords) {
  LanguageToolHelpingWords['LanguageToolTransactionName'] = 'languageToolTransaction'
  LanguageToolHelpingWords['MatchUpdatedTransactionName'] = 'matchUpdated'
  LanguageToolHelpingWords['LoadingTransactionName'] = 'languageToolLoading'
})(LanguageToolHelpingWords || (LanguageToolHelpingWords = {}))

// Singleton DB pour éviter de créer plusieurs instances
let sharedDb = null;
const getDb = (documentId) => {
  if (sharedDb) return sharedDb;
  
  sharedDb = new Dexie('LanguageToolIgnoredSuggestions');
  sharedDb.version(1).stores({
    ignoredWords: `
      ++id,
      &value,
      documentId
    `,
  });
  return sharedDb;
};

// Fonction utilitaire pour la sélection de texte
const selectElementText = (el) => {
  const range = document.createRange()
  range.selectNode(el)
  const sel = window.getSelection()
  sel === null || sel === void 0 ? void 0 : sel.removeAllRanges()
  sel === null || sel === void 0 ? void 0 : sel.addRange(range)
}

// Cache de requêtes pour éviter de vérifier le même texte plusieurs fois
const requestCache = new Map();
const MAX_CACHE_SIZE = 100;

// Fonction pour vérifier si le texte est dans le cache
const getCachedResponse = (text) => {
  return requestCache.get(text);
};

// Fonction pour ajouter une réponse au cache
const addToCache = (text, response) => {
  // Limiter la taille du cache
  if (requestCache.size >= MAX_CACHE_SIZE) {
    // Supprimer la plus ancienne entrée
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

const gimmeDecoration = (from, to, match) =>
  Decoration.inline(from, to, {
    class: `lt lt-${match.rule.issueType}`,
    nodeName: 'span',
    'data-match': JSON.stringify(match),
    uuid: uuidv4(),
  })

const moreThan500Words = (s) => s.trim().split(/\s+/).length >= 500

// Registre des instances d'éditeur actives
const activeEditors = new Set();

export const LanguageTool = Extension.create({
  name: 'languagetool',
  
  addOptions() {
    return {
      language: 'auto',
      apiUrl:'http://127.0.0.1:8010/v2/check',
      automaticMode: true,
      documentId: undefined,
      // Paramètres pour l'optimisation (réduits pour garantir le déclenchement)
      debounceDelay: 800,         // Délai de debounce plus court
      minTextLengthForCheck: 3,   // Seuil de texte minimum très bas
      checkThrottle: 1000,        // Temps minimum entre les vérifications
    }
  },
  
  addStorage() {
    return {
      match: ref(null),
      loading: ref(false),
      editorView: null,
      apiUrl: null,
      decorationSet: null,
      db: null,
      extensionDocId: null,
      textNodesWithPosition: [],
      proofReadInitially: false,
      editorId: uuidv4(),          // ID unique pour chaque instance d'éditeur
      lastCheckTime: 0,            // Horodatage de la dernière vérification
      pendingCheck: false,         // Indique si une vérification est en attente
      currentDecoElements: new Set(), // Éléments de décoration actuels pour nettoyage
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
      ignoreLanguageToolSuggestion: () => ({ editor }) => {
        const storage = this.storage;
        
        if (this.options.documentId === undefined)
          throw new Error('Please provide a unique Document ID(number|string)')
          
        const { selection, doc } = editor.state
        const { from, to } = selection
        
        storage.decorationSet = storage.decorationSet.remove(
          storage.decorationSet.find(from, to)
        )
        
        const content = doc.textBetween(from, to)
        storage.db.ignoredWords.add({ 
          value: content, 
          documentId: `${storage.extensionDocId}` 
        })
        
        return false;
      },
    }
  },
  
  onBeforeCreate() {
    // Initialisation avec les valeurs des options
    const storage = this.storage;
    storage.apiUrl = this.options.apiUrl;
    
    // Initialisation de la base de données partagée
    if (this.options.documentId) {
      storage.extensionDocId = this.options.documentId;
      storage.db = getDb(this.options.documentId);
    }
    
    // Déplacer cleanupEventListeners dans le storage
    storage.cleanupEventListeners = () => {
      if (storage.currentDecoElements.size > 0) {
        storage.currentDecoElements.forEach(el => {
          if (el._mouseEnterListener) {
            el.removeEventListener('click', el._mouseEnterListener);
          }
          if (el._mouseLeaveListener) {
            el.removeEventListener('mouseleave', el._mouseLeaveListener);
          }
        });
        storage.currentDecoElements.clear();
      }
    };
  },
  
  onDestroy() {
    // Nettoyage quand l'extension est détruite
    const storage = this.storage;
    activeEditors.delete(storage.editorId);
    
    // Nettoyer les écouteurs d'événements
    if (storage.cleanupEventListeners) {
      storage.cleanupEventListeners();
    }
  },
  
  addProseMirrorPlugins() {
    const { apiUrl, documentId, automaticMode, debounceDelay, minTextLengthForCheck, checkThrottle } = this.options;
    const storage = this.storage;
    
    // Ajouter l'éditeur au registre des instances actives
    activeEditors.add(storage.editorId);
    
    // Fonction dispatch optimisée
    storage.dispatch = (tr) => {
      if (storage.editorView) {
        storage.editorView.dispatch(tr);
      }
    };
    
    // Mise à jour du match
    storage.updateMatch = (m) => {
      if (!storage.editorView) return;
      
      storage.editorView.dispatch(
        storage.editorView.state.tr.setMeta(
          LanguageToolHelpingWords.MatchUpdatedTransactionName,
          m
        )
      );
    };
    
    // Gestion optimisée des écouteurs d'événements
    storage.addEventListenersToDecorations = () => {
      if (!storage.editorView) return;
      
      // Nettoyer les anciens écouteurs d'abord
      storage.cleanupEventListeners();
      
      const decos = document.querySelectorAll('span.lt');
      if (!decos.length) return;
      
      decos.forEach((el) => {
        // Créer les écouteurs une seule fois par élément
        const mouseEnterListener = (e) => {
          if (!e.target) return;
          selectElementText(e.target);
          const matchString = e.target.getAttribute('data-match');
          if (matchString) storage.updateMatch(JSON.parse(matchString));
          else storage.updateMatch(undefined);
        };
        
        const mouseLeaveListener = () => {
          storage.updateMatch(undefined);
        };
        
        // Stocker les références pour pouvoir les nettoyer plus tard
        el._mouseEnterListener = mouseEnterListener;
        el._mouseLeaveListener = mouseLeaveListener;
        
        el.addEventListener('click', mouseEnterListener);
        el.addEventListener('mouseleave', mouseLeaveListener);
        
        // Ajouter à l'ensemble des éléments actuels
        storage.currentDecoElements.add(el);
      });
    };
    
    // Fonction optimisée pour vérifier un nœud de texte
    storage.proofreadNodeAndUpdateItsDecorations = async (node, offset, cur) => {
      if (!storage.editorView?.state || !node.textContent) return;
      
      storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LoadingTransactionName, true));
      
      // Vérifier le cache d'abord
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
          
          ltRes = await response.json();
          addToCache(node.textContent, ltRes);
        } catch (error) {
          console.error('LanguageTool request failed:', error);
          storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LoadingTransactionName, false));
          return;
        }
      }
      
      if (!storage.editorView) return; // Au cas où l'éditeur a été détruit entre-temps
      
      storage.decorationSet = storage.decorationSet.remove(storage.decorationSet.find(offset, offset + node.nodeSize));
      const nodeSpecificDecorations = [];
      
      for (const match of ltRes.matches) {
        const from = match.offset + offset;
        const to = from + match.length;
        
        if (storage.extensionDocId) {
          const content = storage.editorView.state.doc.textBetween(from, to);
          const result = await storage.db.ignoredWords.get({ 
            value: content, 
            documentId: storage.extensionDocId 
          });
          if (!result) nodeSpecificDecorations.push(gimmeDecoration(from, to, match));
        } else {
          nodeSpecificDecorations.push(gimmeDecoration(from, to, match));
        }
      }
      
      if (!storage.editorView) return; // Vérifier à nouveau si l'éditeur existe toujours
      
      storage.decorationSet = storage.decorationSet.add(cur, nodeSpecificDecorations);
      storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LanguageToolTransactionName, true));
      storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LoadingTransactionName, false));
      
      // Ajouter les écouteurs d'événements aux décorations
      setTimeout(() => storage.addEventListenersToDecorations(), 0);
    };
    
    // Fonction optimisée pour vérifier tout le document
    storage.proofreadAndDecorateWholeDoc = async (doc) => {
      if (!doc || !storage.editorView) return;
      
      storage.textNodesWithPosition = [];
      let index = 0;
      
      // Collecter tous les nœuds de texte
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
      
      // Si aucun texte à vérifier, sortir
      if (storage.textNodesWithPosition.length === 0) return;
      
      // Diviser en chunks pour éviter de surcharger l'API
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
      
      // Aucun chunk à vérifier
      if (chunksOf500Words.length === 0) return;
      
      // Indiquer le chargement
      storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LoadingTransactionName, true));
      
      // Fonction optimisée pour vérifier un chunk de texte
      const getMatchAndSetDecorations = async (doc, text, originalFrom) => {
        if (!text || !storage.editorView) return;
        
        // Vérifier le cache d'abord
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
            
            ltRes = await response.json();
            addToCache(text, ltRes);
          } catch (error) {
            console.error('LanguageTool request failed:', error);
            return;
          }
        }
        
        if (!storage.editorView) return; // Au cas où l'éditeur a été détruit entre-temps
        
        const { matches } = ltRes;
        const decorations = [];
        
        for (const match of matches) {
          const from = match.offset + originalFrom;
          const to = from + match.length;
          
          if (storage.extensionDocId) {
            const content = doc.textBetween(from, to);
            const result = await storage.db.ignoredWords.get({ 
              value: content 
            });
            if (!result) decorations.push(gimmeDecoration(from, to, match));
          } else {
            decorations.push(gimmeDecoration(from, to, match));
          }
        }
        
        if (!storage.editorView) return; // Vérifier à nouveau si l'éditeur existe toujours
        
        storage.decorationSet = storage.decorationSet.remove(storage.decorationSet.find(originalFrom, originalFrom + text.length));
        storage.decorationSet = storage.decorationSet.add(doc, decorations);
        
        if (storage.editorView) {
          storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LanguageToolTransactionName, true));
        }
      };
      
      // Traiter les chunks en série plutôt qu'en parallèle pour réduire la charge
      for (const { text, from } of chunksOf500Words) {
        await getMatchAndSetDecorations(doc, text, from);
        
        // Pause entre les chunks pour ne pas surcharger le serveur
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (storage.editorView) {
        storage.dispatch(storage.editorView.state.tr.setMeta(LanguageToolHelpingWords.LoadingTransactionName, false));
        storage.proofReadInitially = true;
        
        // Ajouter les écouteurs d'événements aux décorations
        setTimeout(() => storage.addEventListenersToDecorations(), 0);
      }
    };
    
    // Créer des versions debouncées des méthodes
    storage.debouncedProofreadNodeAndUpdateItsDecorations = debounce(
      (node, offset, cur) => {
        storage.proofreadNodeAndUpdateItsDecorations(node, offset, cur);
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
        key: new PluginKey(`languagetool-${storage.editorId}`), // Clé unique par instance
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
            const matchUpdated = tr.getMeta(LanguageToolHelpingWords.MatchUpdatedTransactionName);
            const loading = tr.getMeta(LanguageToolHelpingWords.LoadingTransactionName);
            
            if (loading !== undefined) {
              storage.loading.value = loading;
            }
            
            if (matchUpdated !== undefined) {
              storage.match.value = matchUpdated;
            }
            
            const languageToolDecorations = tr.getMeta(LanguageToolHelpingWords.LanguageToolTransactionName);
            if (languageToolDecorations) return storage.decorationSet;
            
            // Vérifier les modifications du document
            if (tr.docChanged && automaticMode && storage.editorView) {
              if (!storage.proofReadInitially) {
                storage.debouncedProofreadAndDecorate(tr.doc);
              } else {
                // Vérifier uniquement les parties modifiées
                changedDescendants(
                  oldEditorState.doc, 
                  tr.doc, 
                  0, 
                  storage.debouncedProofreadNodeAndUpdateItsDecorations
                );
              }
            }
            
            // Mettre à jour les décorations en fonction des modifications du document
            storage.decorationSet = storage.decorationSet.map(tr.mapping, tr.doc);
            
            return storage.decorationSet;
          },
        },
        view: (view) => {
          // Stocker l'éditeur dans le storage
          storage.editorView = view;
          
          // Initialiser la vérification immédiatement au chargement si le mode auto est activé
          if (automaticMode) {
            // Délai court pour laisser l'éditeur s'initialiser complètement
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
//# sourceMappingURL=languagetool.js.map