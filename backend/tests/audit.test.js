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
  });
};
