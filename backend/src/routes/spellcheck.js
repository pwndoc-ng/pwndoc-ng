// Words ignored by the spell checker of the editors (LanguageTool): proposed by the users, ignored for all the users once
// approved (models/spellcheck-word.js)
module.exports = function(app) {

    var Response = require('../lib/httpResponse.js');
    var acl = require('../lib/auth').acl;
    var SpellcheckWord = require('mongoose').model('SpellcheckWord');

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
