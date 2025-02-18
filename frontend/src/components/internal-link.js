
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

export const TriggerMenuExtension = Extension.create({
  name: 'triggerMenu',

  addProseMirrorPlugins() {
    let menuElement = null;
    let selectedIndex = -1;
    let isMenuVisible = false;
    let auditAPI = -1;

    const style = document.createElement('style');
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

      /* Spinner et états */
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

    // Fonctions utilitaires pour la gestion des états


    return [
      new Plugin({
        key: new PluginKey('triggerMenu'),
        props: {
          handleKeyDown(view, event) {
            // Vérification de l'audit ID depuis le path
            let auditId = -1;
            try {
              const path = window.location.pathname.split('/');
              if (path && path.length > 3 && path[1] === "audits") {
                auditId = path[2];
                auditAPI = window.location.href.split("/audits/")[0]+"/api/audits/"+auditId;
                
              }
            } catch (error) {
              console.error('Erreur lors de la récupération de l\'audit ID:', error);
              return false;
            }

            // Si pas d'audit valide, on ne continue pas
            if (auditAPI === -1) {
              
              return false;
            }
            if (isMenuVisible && (event.key === 'Backspace' || event.key === 'Delete')) {
                
                closeMenu();
                return false; // Permet à l'événement de se propager et de supprimer le caractère
              }
            
            // Si le menu est visible, toute touche le ferme sauf les touches de navigation
            if (isMenuVisible) {
              const navigationKeys = ['ArrowUp', 'ArrowDown', 'Enter'];
              
              if (!navigationKeys.includes(event.key)) {
                
                closeMenu();
                return true;
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
            
            // Détection de :: pour ouvrir le menu
            const { state } = view;
            const { selection } = state;
            const { $from } = selection;
            const textBefore = $from.parent.textContent.slice($from.parentOffset - 2, $from.parentOffset);

            if (textBefore === '::') {
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
          throw new Error('Aucun audit ID valide');
        }

        // URL avec l'audit ID
        const url = auditAPI;
        

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch options');
        const data = await response.json();
        var retData = []
        data.datas.findings.forEach( (x,i)=>{
            retData.push({value:x.title})
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
  
      function insertOption(selectedOption, view) {
        const { state } = view;
        const { tr } = state;
        const { selection } = state;
        const { $from } = selection;
        
        // Supprimer les '::'
        const deleteFrom = $from.pos - 2;
        tr.delete(deleteFrom, $from.pos);
        const optionElement = menuElement.querySelector(`[data-value="${selectedOption}"]`);
        const index = optionElement ? optionElement.getAttribute('data-index') : 0;
        // Créer le lien au format texte cliquable
        const linkMark = state.schema.marks.link;
        const linkText = decodeURI(selectedOption); // Vous pouvez personnaliser le texte affiché
        const linkUrl = decodeURI(selectedOption); // L'URL sera la valeur de l'option
        
        // Insérer le texte du lien
        tr.insertText(linkText, deleteFrom);
        
        // Ajouter la marque de lien sur le texte inséré
        tr.addMark(
          deleteFrom,
          deleteFrom + linkText.length,
          linkMark.create({ href: "#IDX_"+padIndex(parseInt(index)+1) })
        );
        tr.removeStoredMark(linkMark);
        // Ajouter un espace après le lien
        const spacePos = deleteFrom + linkText.length;
        tr.insertText(' ', spacePos);
        tr.setStoredMarks(nonLinkMarks);
        // Déplacer le curseur après l'espace
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
          <div class="menu-option" data-value="${encodeURI(option.value)}" data-index="${index}">
            <span class="icon">🎯</span>
            `+ String(option.value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');+`
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
    
      menuElement = document.createElement('div');
      menuElement.className = 'tiptap-trigger-menu';
      menuElement.style.top = `${coords.top + window.scrollY}px`;
      menuElement.style.left = `${coords.left + window.scrollX}px`;
      
      showLoadingState();
      document.body.appendChild(menuElement);
      isMenuVisible = true;

      try {
        // Simuler un délai réseau (à retirer en production)
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const options = await fetchMenuOptions();
        
        renderMenuOptions(options);
        
        selectedIndex = 0;
        updateSelectedOption(menuElement.querySelectorAll('.menu-option'));

        menuElement.addEventListener('click', (e) => {
          const option = e.target.closest('.menu-option');
          if (option) {
            const value = option.getAttribute('data-value');
            insertOption(value, view);
          }
        });
      } catch (error) {
        showErrorState(error);
      }
    
      // Gestionnaire de clic extérieur
      document.addEventListener('click', function closeMenuOnClick(e) {
        if (!menuElement?.contains(e.target)) {
          closeMenu();
          document.removeEventListener('click', closeMenuOnClick);
        }
      });
    }
  },
});
