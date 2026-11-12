// Spell checker of the editors (LanguageTool): texts checked through the backend (authenticated users only, the
// LanguageTool server is not exposed), and words ignored for all the users once approved (models/spellcheck-word.js)
module.exports = function(app) {

    var Response = require('../lib/httpResponse.js');
    var acl = require('../lib/auth').acl;
    var SpellcheckWord = require('mongoose').model('SpellcheckWord');

    // LanguageTool server (LANGUAGETOOL_URL: another server, e.g. LanguageTool outside of the containers)
    var DEFAULT_LANGUAGETOOL_URL = 'http://pwndoc-ng-languagetool:8010';
    var CHECK_MAX_LENGTH = 50000; // Characters of a text checked at once (the editors send chunks of 500 words)
    var CHECK_TIMEOUT = 30000;
    var LANGUAGE = /^(auto|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/;

    // Checks a text: {text, language (default auto)} → {matches} of LanguageTool. The text is never logged
    app.post("/api/spellcheck/check", acl.hasPermission('spellcheck:check'), async function(req, res) {
        // #swagger.tags = ['Spellcheck']

        var text = req.body.text;
        var language = req.body.language === undefined ? 'auto' : req.body.language;
        if (typeof text !== 'string' || typeof language !== 'string' || !LANGUAGE.test(language)) {
            Response.BadParameters(res, 'Required parameters: text (string), language (auto or language code)');
            return;
        }
        if (text.length > CHECK_MAX_LENGTH) {
            Response.Custom(res, 'error', 413, `Text too long: ${CHECK_MAX_LENGTH} characters at most`);
            return;
        }
        if (!text.trim()) {
            Response.Ok(res, {matches: []});
            return;
        }
        var url = `${(process.env.LANGUAGETOOL_URL || DEFAULT_LANGUAGETOOL_URL).replace(/\/+$/, '')}/v2/check`;
        try {
            var response = await fetch(url, {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
                body: new URLSearchParams({text: text, language: language, enabledOnly: 'false'}),
                signal: AbortSignal.timeout(CHECK_TIMEOUT)
            });
            if (!response.ok) {
                Response.Custom(res, 'error', 502, `LanguageTool answered ${response.status}`);
                return;
            }
            var result = await response.json();
            Response.Ok(res, {matches: Array.isArray(result.matches) ? result.matches : []});
        }
        catch (err) {
            Response.Custom(res, 'error', 502, 'LanguageTool is not available');
        }
    });

    // Approved words: ignored by the spell checker
    app.get("/api/spellcheck/words", acl.hasPermission('spellcheck-words:read'), function(req, res) {
        // #swagger.tags = ['Spellcheck']

        SpellcheckWord.getApproved()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // All the words, proposed and approved (validation of the proposals)
    app.get("/api/spellcheck/words/all", acl.hasPermission('spellcheck-words:update'), function(req, res) {
        // #swagger.tags = ['Spellcheck']

        SpellcheckWord.getAll()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Proposes a word to ignore: approved at once when the user can approve the words
    app.post("/api/spellcheck/words", acl.hasPermission('spellcheck-words:create'), function(req, res) {
        // #swagger.tags = ['Spellcheck']

        var word = SpellcheckWord.validWord(req.body.word);
        if (!word) {
            Response.BadParameters(res, 'Required parameters: word (1 to 100 characters without space)');
            return;
        }
        var approve = acl.isAllowed(req.decodedToken.role, 'spellcheck-words:update');
        SpellcheckWord.propose(word, req.decodedToken.id, approve)
        .then(msg => Response.Created(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Approves a proposed word
    app.put("/api/spellcheck/words/:wordId", acl.hasPermission('spellcheck-words:update'), function(req, res) {
        // #swagger.tags = ['Spellcheck']

        if (req.body.status !== 'approved') {
            Response.BadParameters(res, 'Required parameters: status (approved)');
            return;
        }
        SpellcheckWord.approve(req.params.wordId, req.decodedToken.id)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Deletes a word: proposal refused, or word no longer ignored
    app.delete("/api/spellcheck/words/:wordId", acl.hasPermission('spellcheck-words:delete'), function(req, res) {
        // #swagger.tags = ['Spellcheck']

        SpellcheckWord.delete(req.params.wordId)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });
}
