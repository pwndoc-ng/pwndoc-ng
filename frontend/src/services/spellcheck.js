import { api } from 'boot/axios'

// Words ignored by the spell checker of the editors (LanguageTool): proposed by the users, ignored for all the users once
// approved by an administrator (spellcheck-words:update)
const CACHE_DURATION = 5 * 60 * 1000 // Approved words loaded again after 5 minutes (words approved meanwhile)
let cache = null // {time, words: promise of the approved words in lower case}

export default {
  // Approved words
  getWords: function() {
    return api.get('spellcheck/words')
  },

  // All the words, proposed and approved (administrators)
  getAllWords: function() {
    return api.get('spellcheck/words/all')
  },

  // Proposes a word to ignore: {word, status} (approved at once for the administrators)
  proposeWord: function(word) {
    return api.post('spellcheck/words', {word: word})
  },

  approveWord: function(wordId) {
    return api.put(`spellcheck/words/${wordId}`, {status: 'approved'})
  },

  deleteWord: function(wordId) {
    return api.delete(`spellcheck/words/${wordId}`)
  },

  // Approved words in lower case, loaded once for all the editors of the page (none when they cannot be loaded)
  ignoredWords: function() {
    if (!cache || Date.now() - cache.time > CACHE_DURATION) {
      var words = this.getWords()
        .then((response) => response.data.datas.map((word) => word.toLowerCase()))
        .catch(() => [])
      cache = {time: Date.now(), words: words}
    }
    return cache.words
  },

  // Approved words changed: loaded again by the next check
  clearCache: function() {
    cache = null
  }
}
