
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// Finding titles are stored base64 encoded in the menu options (data-value attribute). UTF-8 encoding: btoa alone
// fails on characters outside Latin-1 (typographic apostrophe, oe ligature...)
export const encodeOption = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
export const decodeOption = (value) => new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));

// Style of the menu, added once to the page for all the editors
const MENU_STYLE_ID = 'tiptap-trigger-menu-style';

// The menu is opened by ":::" (README): a third ":" typed after "::" opens it and is not typed. The other characters
// typed after "::" stay in the text (IPv6 addresses, std::string...), as the arrows and the editing keys
const opensMenu = (event) => event.key === ':';

export const TriggerMenuExtension = Extension.create({
  name: 'triggerMenu',

  addProseMirrorPlugins() {
    let menuElement = null;
    let selectedIndex = -1;
    let isMenuVisible = false;
    let auditAPI = -1;
    let outsideClickListener = null;

    if (!document.getElementById(MENU_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = MENU_STYLE_ID;
      style.textContent = `
      .tiptap-trigger-menu {
        position: absolute;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        padding: 4px;
        min-width: 180px;
        z-index: 1000;
        border: 1px solid #e2e8f0;
        animation: menuFadeIn 0.15s ease-out;
      }

      @keyframes menuFadeIn {
        from {
          opacity: 0;
          transform: translateY(-8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .tiptap-trigger-menu .menu-option {
        padding: 8px 12px;
        margin: 2px 0;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        font-size: 14px;
        color: #1a202c;
        transition: all 0.15s ease;
      }

      .tiptap-trigger-menu .menu-option:hover {
        background-color: #f7fafc;
      }

      .tiptap-trigger-menu .menu-option.selected {
        background-color: #edf2f7;
      }

      .tiptap-trigger-menu .icon {
        margin-right: 8px;
        color: #4a5568;
        font-size: 16px;
      }

      .tiptap-trigger-menu .shortcut {
        margin-left: auto;
        color: #718096;
        font-size: 12px;
        opacity: 0.7;
      }

      .menu-separator {
        height: 1px;
        background-color: #e2e8f0;
        margin: 4px 0;
      }

      /* Spinner and states */
      .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        min-height: 100px;
      }

      .spinner {
        width: 24px;
        height: 24px;
        border: 3px solid #e2e8f0;
        border-top: 3px solid #4299e1;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      .loading-text {
        margin-left: 12px;
        color: #718096;
        font-size: 14px;
      }

      .error-state {
        padding: 16px;
        color: #e53e3e;
        text-align: center;
        font-size: 14px;
      }

      .empty-state {
        padding: 16px;
        color: #718096;
        text-align: center;
        font-size: 14px;
      }
      `;
      document.head.appendChild(style);
    }

    // Utility functions for state management


    return [
      new Plugin({
        key: new PluginKey('triggerMenu'),
        // Menu opened (or loading) when the editor is destroyed (page left): removed
        view: () => ({ destroy: () => closeMenu() }),
        props: {
          handleKeyDown(view, event) {
            // Check audit ID from path
            let auditId = -1;
            try {
              const path = window.location.pathname.split('/');
              if (path && path.length > 3 && path[1] === "audits") {
                auditId = path[2];
                auditAPI = window.location.href.split("/audits/")[0]+"/api/audits/"+auditId;
                
              }
            } catch (error) {
              console.error('Error retrieving audit ID:', error);
              return false;
            }

            // If no valid audit, we don't continue
            if (auditAPI === -1) {
              
              return false;
            }
            if (isMenuVisible && (event.key === 'Backspace' || event.key === 'Delete')) {
                
                closeMenu();
                return false; // Allow the event to propagate and delete the character
              }
            
            // If the menu is visible, any key closes it except navigation keys: Escape only closes it, the other keys keep
            // their effect (typed character, caret moved)
            if (isMenuVisible) {
              const navigationKeys = ['ArrowUp', 'ArrowDown', 'Enter'];
              
              if (!navigationKeys.includes(event.key)) {
                
                closeMenu();
                return event.key === 'Escape';
              }

              const options = menuElement.querySelectorAll('.menu-option');
              
              switch (event.key) {
                case 'ArrowUp':
                  event.preventDefault();
                  if (options.length > 0) {
                    selectedIndex = selectedIndex <= 0 ? options.length - 1 : selectedIndex - 1;
                    updateSelectedOption(options);
                  }
                  return true;
                
                case 'ArrowDown':
                  event.preventDefault();
                  if (options.length > 0) {
                    selectedIndex = selectedIndex >= options.length - 1 ? 0 : selectedIndex + 1;
                    updateSelectedOption(options);
                  }
                  return true;
                
                case 'Enter':
                  if (selectedIndex >= 0) {
                    event.preventDefault();
                    const option = options[selectedIndex];
                    if (option) {
                      const value = option.getAttribute('data-value');
                      insertOption(value, view);
                    }
                    return true;
                  }
                  break;
              }
            }
            
            // Detection of :: to open the menu
            const { state } = view;
            const { selection } = state;
            const { $from } = selection;
            const textBefore = $from.parent.textContent.slice($from.parentOffset - 2, $from.parentOffset);

            if (textBefore === '::' && opensMenu(event)) {
              const coords = view.coordsAtPos($from.pos);
              
              showMenu(coords, view);
              return true;
            }
            return false;
          }
        },
      }),
    ];

    async function fetchMenuOptions() {
      try {
        if (auditAPI === -1) {
          throw new Error('No valid audit ID');
        }

        // URL with audit ID
        const url = auditAPI;
        

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch options');
        const data = await response.json();
        var retData = []
        data.datas.findings.forEach( (x,i)=>{
            retData.push({value:x.title,unique_id:x._id})
        })
        return retData;
      } catch (error) {
        console.error('Error fetching menu options:', error);
        throw error;
      }
    }
    function showLoadingState() {
        if (!menuElement) return;
        menuElement.innerHTML = `
          <div class="loading-state">
            <div class="spinner"></div>
            <span class="loading-text">Chargement des options...</span>
          </div>
        `;
      }
  
      function showErrorState(error) {
        if (!menuElement) return;
        menuElement.innerHTML = `
          <div class="error-state">
            <div>Une erreur est survenue</div>
            <div style="font-size: 12px; margin-top: 4px;">${error.message}</div>
          </div>
        `;
      }
  
      function showEmptyState() {
        if (!menuElement) return;
        menuElement.innerHTML = `
          <div class="empty-state">
            Aucune option disponible
          </div>
        `;
      }
    function updateSelectedOption(options) {
        options.forEach((option, index) => {
          if (index === selectedIndex) {
            option.classList.add('selected');
          } else {
            option.classList.remove('selected');
          }
        });
      }
  
    function encodeHTMLEntities( s){ return s.replace(/[\u00A0-\u9999<>\&]/g, i => '&#'+i.charCodeAt(0)+';')}
      function insertOption(selectedOption, view) {
        const { state } = view;
        const { tr } = state;
        const { selection } = state;
        const { $from } = selection;
        
        // Delete the '::'
        const deleteFrom = $from.pos - 2;
        tr.delete(deleteFrom, $from.pos);
        const optionElement = menuElement.querySelector(`[data-value="${selectedOption}"]`);
        const index = optionElement ? optionElement.getAttribute('data-index') : 0;
        // Create the link in clickable text format
        const linkMark = state.schema.marks.link;
        const linkText = decodeOption(selectedOption); // Title of the finding (no decodeURI: a title can contain '%')
        
        // Insert the link text
        tr.insertText(linkText, deleteFrom);
        
        // Add the link mark on the inserted text
        tr.addMark(
          deleteFrom,
          deleteFrom + linkText.length,
          linkMark.create({ href: "#"+index })
        );
        tr.removeStoredMark(linkMark);
        const nonLinkMarks = (state.storedMarks || []).filter(mark => mark.type !== linkMark);

        // Add a space after the link
        const spacePos = deleteFrom + linkText.length;
        tr.insertText(' ', spacePos);
        tr.setStoredMarks(nonLinkMarks);
        // Move cursor after the space
        const newPos = spacePos + 1;
        tr.setSelection(state.selection.constructor.near(tr.doc.resolve(newPos)));
        view.dispatch(tr);
        closeMenu();
      }
      function padIndex(index) {
        return String(index).padStart(3, '0');
      }
      function closeMenu() {
        if (menuElement) {
          menuElement.remove();
          menuElement = null;
          isMenuVisible = false;
          selectedIndex = -1;
        }
        if (outsideClickListener) {
          document.removeEventListener('click', outsideClickListener);
          outsideClickListener = null;
        }
      }
        function renderMenuOptions(options) {
      if (!menuElement) return;
      
      if (!options || options.length === 0) {
        showEmptyState();
        return;
      }

      const menuContent = options.map((option, index) => {
        if (option === null) {
          return '<div class="menu-separator"></div>';
        }
        return `
          <div class="menu-option" data-value="${encodeOption(option.value)}" data-index="${option.unique_id}">
            <span class="icon">🎯</span>
            ${encodeHTMLEntities(option.value)}
            ${option.shortcut ? `<span class="shortcut">${option.shortcut}</span>` : ''}
          </div>
        `;
      }).join('');

      menuElement.innerHTML = menuContent;
    }
    async function showMenu(coords, view) {
      if (auditAPI === -1) {
        console.error('❌ Tentative d\'ouverture du menu sans audit ID valide');
        return;
      }

      closeMenu();
    
      // Menu of this opening: the findings answered after it was closed (or opened again) are ignored
      const element = document.createElement('div');
      menuElement = element;
      menuElement.className = 'tiptap-trigger-menu';
      menuElement.style.top = `${coords.top + window.scrollY}px`;
      menuElement.style.left = `${coords.left + window.scrollX}px`;
      
      showLoadingState();
      document.body.appendChild(menuElement);
      isMenuVisible = true;

      element.addEventListener('click', (e) => {
        const option = e.target.closest('.menu-option');
        if (option) {
          const value = option.getAttribute('data-value');
          insertOption(value, view);
        }
      });
      // Outside click handler (removed with the menu)
      outsideClickListener = (e) => {
        if (!element.contains(e.target)) closeMenu();
      };
      document.addEventListener('click', outsideClickListener);

      try {
        const options = await fetchMenuOptions();
        if (menuElement !== element) return;

        renderMenuOptions(options);
        
        selectedIndex = 0;
        updateSelectedOption(menuElement.querySelectorAll('.menu-option'));
      } catch (error) {
        if (menuElement === element) showErrorState(error);
      }
    }
  },
});
