/*
  At the end
  1 Audit: {name: "Audit 1", language: "en", auditType: "Web"}
*/

module.exports = function (request, app) {
  describe("Audit Suite Tests", () => {
    var userToken = "";

    var audit1Id = "";
    var audit2Id = "";

    beforeAll(async () => {
      var response = await request(app)
        .post("/api/users/token")
        .send({ username: "admin", password: "Admin123" });
      userToken = response.body.datas.token;
    });

    describe("Audit CRUD operations", () => {
      it("Get Audits (no existing audit in db)", async () => {
        var response = await request(app)
          .get("/api/audits")
          .set("Cookie", [`token=JWT ${userToken}`]);

        expect(response.status).toBe(200);
        expect(response.body.datas).toHaveLength(0);
      });

      it("Create audit with partial information", async () => {
        var audit = { name: "Audit 1" };
        var response = await request(app)
          .post("/api/audits")
          .set("Cookie", [`token=JWT ${userToken}`])
          .send(audit);

        expect(response.status).toBe(422);
      });

      it("Create audit with invalid audit type", async () => {
        var audit = {
          name: "Audit 1",
          language: "en",
          auditType: "Internal Test",
        };
        var response = await request(app)
          .post("/api/audits")
          .set("Cookie", [`token=JWT ${userToken}`])
          .send(audit);

        expect(response.status).toBe(404);
      });

      it("Create audit", async () => {
        var audit = { name: "Audit 1", language: "en", auditType: "Web" };
        var response = await request(app)
          .post("/api/audits")
          .set("Cookie", [`token=JWT ${userToken}`])
          .send(audit);

        expect(response.status).toBe(201);
        audit1Id = response.body.datas.audit._id;
      });

      it("Create second audit", async () => {
        var audit = { name: "Audit 2", language: "fr", auditType: "Web" };
        var response = await request(app)
          .post("/api/audits")
          .set("Cookie", [`token=JWT ${userToken}`])
          .send(audit);

        expect(response.status).toBe(201);
        audit2Id = response.body.datas.audit._id;
      });

      it("Delete audit", async () => {
        var response = await request(app)
          .delete(`/api/audits/${audit2Id}`)
          .set("Cookie", [`token=JWT ${userToken}`]);
        expect(response.status).toBe(200);

        response = await request(app)
          .get("/api/audits")
          .set("Cookie", [`token=JWT ${userToken}`]);
        expect(response.body.datas).toHaveLength(1);
      });

      it("Update audit general info", async () => {
        var auditGeneralInfo = {
          _id: audit1Id,
          scope: ["Scope Item 1", "Scope Item 2"],
        };

        var response = await request(app)
          .put(`/api/audits/${audit1Id}/general`)
          .set("Cookie", [`token=JWT ${userToken}`])
          .send(auditGeneralInfo);

        expect(response.status).toBe(200);
      });

      it("Get audit general info", async () => {
        var response = await request(app)
          .get(`/api/audits/${audit1Id}/general`)
          .set("Cookie", [`token=JWT ${userToken}`]);

        expect(response.status).toBe(200);

        expect(response.body.datas.name).toBe("Audit 1");
        expect(response.body.datas.auditType).toBe("Web");
        expect(response.body.datas.language).toBe("en");
        expect(response.body.datas.collaborators).toHaveLength(0);
        expect(response.body.datas.reviewers).toHaveLength(0);
        expect(response.body.datas.customFields).toHaveLength(0);
        expect(response.body.datas.scope).toHaveLength(2);
        expect(response.body.datas.scope[0]).toBe("Scope Item 1");
        expect(response.body.datas.scope[1]).toBe("Scope Item 2");
      });
    });

    describe("Audit clone", () => {
      var otherUserToken = "";

      beforeAll(async () => {
        // Regular user (role 'user') who is not creator, collaborator nor reviewer of Audit 1
        var response = await request(app)
          .post("/api/users/token")
          .send({ username: "user2", password: "User1234" });
        otherUserToken = response.body.datas.token;
      });

      it("Clone audit without name", async () => {
        var response = await request(app)
          .post(`/api/audits/${audit1Id}/clone`)
          .set("Cookie", [`token=JWT ${userToken}`])
          .send({});

        expect(response.status).toBe(422);
      });

      it("Clone audit with invalid ID", async () => {
        var response = await request(app)
          .post(`/api/audits/invalidId/clone`)
          .set("Cookie", [`token=JWT ${userToken}`])
          .send({ name: "Audit clone" });

        expect(response.status).toBe(422);
      });

      it("Clone audit of another user without access", async () => {
        var response = await request(app)
          .post(`/api/audits/${audit1Id}/clone`)
          .set("Cookie", [`token=JWT ${otherUserToken}`])
          .send({ name: "Stolen audit" });

        expect(response.status).toBe(404);

        response = await request(app)
          .get("/api/audits")
          .set("Cookie", [`token=JWT ${otherUserToken}`]);
        expect(response.body.datas).toHaveLength(0);
      });

      it("Clone audit", async () => {
        var response = await request(app)
          .post(`/api/audits/${audit1Id}/clone`)
          .set("Cookie", [`token=JWT ${userToken}`])
          .send({ name: "Audit 1 clone" });

        expect(response.status).toBe(201);
        var cloneId = response.body.datas.audit._id;
        expect(cloneId).not.toBe(audit1Id);

        response = await request(app)
          .get(`/api/audits/${cloneId}/general`)
          .set("Cookie", [`token=JWT ${userToken}`]);
        expect(response.status).toBe(200);
        expect(response.body.datas.name).toBe("Audit 1 clone");
        expect(response.body.datas.scope).toHaveLength(2);

        // Remove clone to keep the state expected by the next test suites
        response = await request(app)
          .delete(`/api/audits/${cloneId}`)
          .set("Cookie", [`token=JWT ${userToken}`]);
        expect(response.status).toBe(200);
      });

      it("Clone audit as collaborator does not leak users data", async () => {
        // Add a regular user as collaborator of Audit 1
        var response = await request(app)
          .get("/api/users/tmpuser")
          .set("Cookie", [`token=JWT ${userToken}`]);
        var collaboratorId = response.body.datas._id;

        response = await request(app)
          .put(`/api/audits/${audit1Id}/general`)
          .set("Cookie", [`token=JWT ${userToken}`])
          .send({ collaborators: [{ _id: collaboratorId }] });
        expect(response.status).toBe(200);

        response = await request(app)
          .post("/api/users/token")
          .send({ username: "tmpuser", password: "Tmpuser1" });
        var collaboratorToken = response.body.datas.token;

        response = await request(app)
          .post(`/api/audits/${audit1Id}/clone`)
          .set("Cookie", [`token=JWT ${collaboratorToken}`])
          .send({ name: "Audit 1 collaborator clone" });

        expect(response.status).toBe(201);
        var clone = response.body.datas.audit;
        expect(clone.collaborators).toEqual([collaboratorId]);
        var serialized = JSON.stringify(clone);
        expect(serialized).not.toContain("password");
        expect(serialized).not.toContain("refreshTokens");
        expect(serialized).not.toContain("totpSecret");

        // Restore state expected by the next test suites
        response = await request(app)
          .delete(`/api/audits/${clone._id}`)
          .set("Cookie", [`token=JWT ${userToken}`]);
        expect(response.status).toBe(200);

        response = await request(app)
          .put(`/api/audits/${audit1Id}/general`)
          .set("Cookie", [`token=JWT ${userToken}`])
          .send({ collaborators: [] });
        expect(response.status).toBe(200);
      });
    });
    describe("Audit comments", () => {
      var user2Token = "";
      var tmpuserToken = "";
      var tmpuserId = "";
      var findingId = "";
      var generalCommentId = "";
      var quoteCommentId = "";
      var cookie = (token) => [`token=JWT ${token}`];

      beforeAll(async () => {
        var response = await request(app).post("/api/users/token").send({ username: "user2", password: "User1234" });
        user2Token = response.body.datas.token;
        response = await request(app).post("/api/users/token").send({ username: "tmpuser", password: "Tmpuser1" });
        tmpuserToken = response.body.datas.token;
        response = await request(app).get("/api/users/tmpuser").set("Cookie", cookie(userToken));
        tmpuserId = response.body.datas._id;

        // tmpuser is collaborator (editor) of Audit 1
        await request(app).put(`/api/audits/${audit1Id}/general`).set("Cookie", cookie(userToken)).send({ collaborators: [{ _id: tmpuserId }] });
        await request(app).post(`/api/audits/${audit1Id}/findings`).set("Cookie", cookie(userToken))
          .send({ title: "Commented finding", description: "<p>The parameter id is injectable</p>" });
        response = await request(app).get(`/api/audits/${audit1Id}`).set("Cookie", cookie(userToken));
        findingId = response.body.datas.findings.find((f) => f.title === "Commented finding")._id;
      });

      afterAll(async () => {
        await request(app).put(`/api/audits/${audit1Id}/general`).set("Cookie", cookie(userToken)).send({ collaborators: [] });
      });

      it("Get comments (none)", async () => {
        var response = await request(app).get(`/api/audits/${audit1Id}/comments`).set("Cookie", cookie(userToken));
        expect(response.status).toBe(200);
        expect(response.body.datas).toHaveLength(0);
      });

      it("Comment a field of the general information", async () => {
        var response = await request(app).post(`/api/audits/${audit1Id}/comments`).set("Cookie", cookie(userToken))
          .send({ target: { kind: "general", field: "name" }, text: "Name too generic" });
        expect(response.status).toBe(200);
        expect(response.body.datas).toHaveLength(1);
        var comment = response.body.datas[0];
        expect(comment.target).toEqual({ kind: "general", field: "name" });
        expect(comment.author.username).toBe("admin");
        expect(comment.resolved).toBe(false);
        generalCommentId = comment._id;
      });

      it("Comment a passage of a finding text field", async () => {
        var response = await request(app).post(`/api/audits/${audit1Id}/comments`).set("Cookie", cookie(tmpuserToken))
          .send({ target: { kind: "finding", findingId: findingId, field: "description" }, quote: { exact: "injectable", prefix: "parameter id is " }, text: "Explain why" });
        expect(response.status).toBe(200);
        var comment = response.body.datas.find((c) => c.text === "Explain why");
        expect(comment.target.findingId).toBe(findingId);
        expect(comment.quote).toEqual({ exact: "injectable", prefix: "parameter id is ", suffix: "" });
        expect(comment.author.username).toBe("tmpuser");
        quoteCommentId = comment._id;
      });

      it("Comment an image of a finding text field", async () => {
        var response = await request(app).post(`/api/audits/${audit1Id}/comments`).set("Cookie", cookie(userToken))
          .send({ target: { kind: "finding", findingId: findingId, field: "description" }, image: { src: "5f1c0c3c2a6b2c0012345678", alt: "Burp request", occurrence: 1 }, text: "Crop the screenshot" });
        expect(response.status).toBe(200);
        var comment = response.body.datas.find((c) => c.text === "Crop the screenshot");
        expect(comment.image).toEqual({ src: "5f1c0c3c2a6b2c0012345678", alt: "Burp request", occurrence: 1 });
        expect(comment.quote).toBeUndefined();
        response = await request(app).delete(`/api/audits/${audit1Id}/comments/${comment._id}`).set("Cookie", cookie(userToken));
        expect(response.status).toBe(200);
      });

      it("Reject invalid comments", async () => {
        var post = (body) => request(app).post(`/api/audits/${audit1Id}/comments`).set("Cookie", cookie(userToken)).send(body);
        expect((await post({ target: { kind: "general", field: "name" } })).status).toBe(422);
        expect((await post({ target: { kind: "unknown", field: "name" }, text: "x" })).status).toBe(422);
        expect((await post({ target: { kind: "finding", findingId: "5f1c0c3c2a6b2c0012345678", field: "title" }, text: "x" })).status).toBe(422);
        expect((await post({ target: { kind: "general", field: "name" }, quote: { exact: "" }, text: "x" })).status).toBe(422);
        expect((await post({ target: { kind: "general", field: "name" }, image: { src: "" }, text: "x" })).status).toBe(422);
        expect((await post({ target: { kind: "general", field: "name" }, quote: { exact: "a" }, image: { src: "b" }, text: "x" })).status).toBe(422);
      });

      it("Users without access to the audit cannot read or comment", async () => {
        var response = await request(app).get(`/api/audits/${audit1Id}/comments`).set("Cookie", cookie(user2Token));
        expect(response.status).toBe(404);
        response = await request(app).post(`/api/audits/${audit1Id}/comments`).set("Cookie", cookie(user2Token))
          .send({ target: { kind: "general", field: "name" }, text: "x" });
        expect(response.status).toBe(404);
      });

      it("Reply to a comment", async () => {
        var response = await request(app).post(`/api/audits/${audit1Id}/comments/${quoteCommentId}/replies`).set("Cookie", cookie(userToken))
          .send({ text: "Because of string concatenation" });
        expect(response.status).toBe(200);
        var comment = response.body.datas.find((c) => c._id === quoteCommentId);
        expect(comment.replies).toHaveLength(1);
        expect(comment.replies[0].author.username).toBe("admin");
      });

      it("Only the author edits a comment", async () => {
        var response = await request(app).put(`/api/audits/${audit1Id}/comments/${generalCommentId}`).set("Cookie", cookie(tmpuserToken))
          .send({ text: "Changed by someone else" });
        expect(response.status).toBe(403);
        response = await request(app).put(`/api/audits/${audit1Id}/comments/${generalCommentId}`).set("Cookie", cookie(userToken))
          .send({ text: "Audit name too generic" });
        expect(response.status).toBe(200);
        expect(response.body.datas.find((c) => c._id === generalCommentId).text).toBe("Audit name too generic");
      });

      it("Editors resolve comments of other users", async () => {
        var response = await request(app).put(`/api/audits/${audit1Id}/comments/${generalCommentId}`).set("Cookie", cookie(tmpuserToken))
          .send({ resolved: true });
        expect(response.status).toBe(200);
        var comment = response.body.datas.find((c) => c._id === generalCommentId);
        expect(comment.resolved).toBe(true);
        expect(comment.resolvedBy.username).toBe("tmpuser");
      });

      it("Only the author or an administrator deletes a comment", async () => {
        var response = await request(app).delete(`/api/audits/${audit1Id}/comments/${generalCommentId}`).set("Cookie", cookie(tmpuserToken));
        expect(response.status).toBe(403);
        response = await request(app).delete(`/api/audits/${audit1Id}/comments/${generalCommentId}`).set("Cookie", cookie(userToken));
        expect(response.status).toBe(200);
        expect(response.body.datas.map((c) => c._id)).toEqual([quoteCommentId]);
        response = await request(app).delete(`/api/audits/${audit1Id}/comments/invalidId`).set("Cookie", cookie(userToken));
        expect(response.status).toBe(404);
      });

      it("Deleting a finding deletes its comments", async () => {
        var response = await request(app).delete(`/api/audits/${audit1Id}/findings/${findingId}`).set("Cookie", cookie(userToken));
        expect(response.status).toBe(200);
        response = await request(app).get(`/api/audits/${audit1Id}/comments`).set("Cookie", cookie(userToken));
        expect(response.body.datas).toHaveLength(0);
      });

      it("Approval blocked by open comments when enabled in settings", async () => {
        // Audit created by tmpuser: admin can approve it (approvers cannot be creator or collaborator)
        var response = await request(app).post("/api/audits").set("Cookie", cookie(tmpuserToken))
          .send({ name: "Audit to review", language: "en", auditType: "Web" });
        var reviewAuditId = response.body.datas.audit._id;
        response = await request(app).put("/api/settings").set("Cookie", cookie(userToken)).send({
          reviews: { enabled: true, public: { mandatoryReview: false, minReviewers: 1, blockApprovalWithOpenComments: true }, private: { removeApprovalsUponUpdate: false } },
        });
        expect(response.status).toBe(200);
        response = await request(app).put(`/api/audits/${reviewAuditId}/updateReadyForReview`).set("Cookie", cookie(tmpuserToken)).send({ state: "REVIEW" });
        expect(response.status).toBe(200);

        response = await request(app).post(`/api/audits/${reviewAuditId}/comments`).set("Cookie", cookie(userToken))
          .send({ target: { kind: "general", field: "date_start" }, text: "Start date missing" });
        var commentId = response.body.datas[0]._id;
        response = await request(app).put(`/api/audits/${reviewAuditId}/toggleApproval`).set("Cookie", cookie(userToken));
        expect(response.status).toBe(403);

        response = await request(app).put(`/api/audits/${reviewAuditId}/comments/${commentId}`).set("Cookie", cookie(tmpuserToken)).send({ resolved: true });
        expect(response.status).toBe(200);
        response = await request(app).put(`/api/audits/${reviewAuditId}/toggleApproval`).set("Cookie", cookie(userToken));
        expect(response.status).toBe(200);

        // Restore state expected by the next test suites
        expect((await request(app).put("/api/settings/revert").set("Cookie", cookie(userToken))).status).toBe(200);
        expect((await request(app).delete(`/api/audits/${reviewAuditId}`).set("Cookie", cookie(userToken))).status).toBe(200);
      });
    });
  });
};
