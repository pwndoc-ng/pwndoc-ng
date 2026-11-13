module.exports = function(request, app) {
    describe('Application settings', () => {
      var userToken = '';
      beforeAll(async () => {
        var response = await request(app).post('/api/users/token').send({username: 'admin', password: 'Admin123'})
        userToken = response.body.datas.token
      })

      const defaultPublicSettings = {
        "report": {
            "enabled": true,
            "public": {
              "captions": [
                "Figure",
              ],
              "cvssColors": {
                "criticalColor": "#212121",
                "highColor": "#fe0000",
                "lowColor": "#008000",
                "mediumColor": "#f9a009",
                "noneColor": "#4a86e8",
              },
              "extendCvssTemporalEnvironment": false,
              "findingSidebarTemplate": "{title}",
              "imageDefaultWidth": "large",
              "highlightWarning": false,
              "highlightWarningColors": ["#ffff00"],
              "remediationColorsComplexity": {
                "highColor": "#FF2F2F",
                "lowColor": "#4472c4",
                "mediumColor": "#ffc000",
              },
              "remediationColorsPriority": {
                "highColor": "#ff2f2f",
                "lowColor": "#4472c4",
                "mediumColor": "#ffc000",
                "urgentColor": "#C00000",
              },
            },
          },
        "reviews": {
          "enabled": false,
          "public": {
            "mandatoryReview": false,
            "minReviewers": 1,
            "blockApprovalWithOpenComments": false,
          },
        },
        "ai": {
          "enabled": false,
        },
        "qa": {
          "public": {
            "checks": {"completeness": true, "comments": true, "internalLinks": true, "images": true, "references": true, "duplicates": true},
          },
        },
        "danger": { 
          "enabled": false,
          "public": {
            "nbdaydelete": 1,
            },
         },
      };

      const defaultSettings = {
        "report": {
            "enabled": true,
            "private": {
              "imageBorder": false,
              "imageBorderColor": "#000000",
            },
            "public": {
              "captions": [
                "Figure",
              ],
              "cvssColors": {
                "criticalColor": "#212121",
                "highColor": "#fe0000",
                "lowColor": "#008000",
                "mediumColor": "#f9a009",
                "noneColor": "#4a86e8",
              },
              "extendCvssTemporalEnvironment": false,
              "findingSidebarTemplate": "{title}",
              "imageDefaultWidth": "large",
              "highlightWarning": false,
              "highlightWarningColors": ["#ffff00"],
              "remediationColorsComplexity": {
                "highColor": "#FF2F2F",
                "lowColor": "#4472c4",
                "mediumColor": "#ffc000",
              },
              "remediationColorsPriority": {
                "highColor": "#ff2f2f",
                "lowColor": "#4472c4",
                "mediumColor": "#ffc000",
                "urgentColor": "#C00000",
              },
            },
          },
        "reviews": {
          "enabled": false,
          "private": {
            "removeApprovalsUponUpdate": false,
          },
          "public": {
            "mandatoryReview": false,
            "minReviewers": 1,
            "blockApprovalWithOpenComments": false,
          },
        },
        "ai": {
          "enabled": false,
          "private": {
            "url": "", "model": "", "tokenParameter": "max_tokens", "maxTokens": 2000, "timeout": 120, "systemRole": true, "extraParameters": "",
            "guidelines": [], "pseudonymize": false,
          },
        },
        "qa": {
          "public": {
            "checks": {"completeness": true, "comments": true, "internalLinks": true, "images": true, "references": true, "duplicates": true},
          },
        },
        "danger": { 
          "enabled": false,
          "public": {
            "nbdaydelete": 1,
            },
         },
        "backups": {
          "enabled": false,
          "private": {
            "time": "02:00",
            "days": [1, 2, 3, 4, 5],
            "keepDaily": 5,
            "keepWeekly": 2,
            "weeklyDay": 5,
          },
        },
      };

      it('Get settings', async () => {
          var response = await request(app).get('/api/settings')
          .set('Cookie', [
            `token=JWT ${userToken}`
          ]);
      
          expect(response.status).toBe(200);
          expect(response.body.datas).toEqual(defaultSettings);
      })

      it('Get public settings', async () => {
          var response = await request(app).get('/api/settings/public')
          .set('Cookie', [
            `token=JWT ${userToken}`
          ]);
          expect(response.status).toBe(200);
          expect(response.body.datas).toEqual(defaultPublicSettings);
      })

      it('Edit settings', async () => {
        const fullModification = {
          "report": {
              "enabled": false,
              "private": {
                "imageBorder": true,
                "imageBorderColor": "#123456",
              },
              "public": {
                "captions": [
                  "Figure",
                  "Test",
                ],
                "cvssColors": {
                  "criticalColor": "#123456",
                  "highColor": "#123456",
                  "lowColor": "#123456",
                  "mediumColor": "#123456",
                  "noneColor": "#123456",
                },
                "extendCvssTemporalEnvironment": false,
                "findingSidebarTemplate": "{identifier} - {title} [{custom.Asset}]",
                "imageDefaultWidth": "medium",
                "highlightWarning": true,
                "highlightWarningColors": ["#00ff00", "#00ffff"],
                "remediationColorsComplexity": {
                  "highColor": "#FF2F2F",
                  "lowColor": "#4472c4",
                  "mediumColor": "#ffc000",
                },
                "remediationColorsPriority": {
                  "highColor": "#ff2f2f",
                  "lowColor": "#4472c4",
                  "mediumColor": "#ffc000",
                  "urgentColor": "#C00000",
                },
              },
            },
          "reviews": {
            "enabled": true,
            "private": {
              "removeApprovalsUponUpdate": true,
            },
            "public": {
              "mandatoryReview": true,
              "minReviewers": 2,
              "blockApprovalWithOpenComments": true,
            },
          },
          "ai": {
            "enabled": true,
            "private": {
              "url": "https://ai.example.test:8501/v1", "model": "writer", "tokenParameter": "max_completion_tokens", "maxTokens": 800, "timeout": 300, "systemRole": false,
              "extraParameters": "{\"reasoning_effort\": \"low\"}",
              "guidelines": ["Formal tone", "Write \"the auditor\", never \"we\""], "pseudonymize": true,
            },
          },
          "qa": {
            "public": {
              "checks": {"completeness": false, "comments": true, "internalLinks": false, "images": true, "references": true, "duplicates": false},
            },
          },
          "danger": { 
            "enabled": true,
            "public": {
              "nbdaydelete": 2,
            },
          },
          // Automatic backups not enabled: the check of every minute would create backups during the other tests
          "backups": {
            "enabled": false,
            "private": {
              "time": "23:30",
              "days": [0, 6],
              "keepDaily": 3,
              "keepWeekly": 1,
              "weeklyDay": 0,
            },
          },
        };
        
        var response = await request(app).put('/api/settings')
          .set('Cookie', [
            `token=JWT ${userToken}`
          ])
          .send(fullModification);
        expect(response.status).toBe(200);

        var response = await request(app).get('/api/settings')
          .set('Cookie', [
            `token=JWT ${userToken}`
          ]);
        expect(response.status).toBe(200);
        expect(response.body.datas).toEqual(fullModification);

        const partialModification = {
          "reviews": {
            "public": {
              "mandatoryReview": false,
              "minReviewers": 5,
              "blockApprovalWithOpenComments": false,
            }
          }
        };
        var response = await request(app).put('/api/settings')
          .set('Cookie', [
            `token=JWT ${userToken}`
          ])
          .send(partialModification);
        expect(response.status).toBe(200);

        var response = await request(app).get('/api/settings')
          .set('Cookie', [
            `token=JWT ${userToken}`
          ]);
        expect(response.status).toBe(200);

        expect(response.body.datas.reviews.public.mandatoryReview).toEqual(false);
        expect(response.body.datas.reviews.public.minReviewers).toEqual(5);
        expect(response.body.datas.report.private.imageBorderColor).toEqual("#123456");
    })

    it('Writing guidelines of the AI: one per line, text given (settings exported before) split into lines, limited', async () => {
      var put = (guidelines) => request(app).put('/api/settings').set('Cookie', [`token=JWT ${userToken}`]).send({ai: {private: {guidelines}}})
      var response = await put('Formal tone\r\n\n  Short sentences ')
      expect(response.status).toBe(200)
      var response = await request(app).get('/api/settings').set('Cookie', [`token=JWT ${userToken}`])
      expect(response.body.datas.ai.private.guidelines).toEqual(['Formal tone', 'Short sentences'])
      expect(response.body.datas.ai.private.url).toBe('https://ai.example.test:8501/v1') // Other settings kept

      expect((await put(Array.from({length: 101}, (_, i) => `Guideline ${i}`))).status).toBe(422)
      expect((await put(['x'.repeat(1001)])).status).toBe(422)
      var response = await request(app).get('/api/settings').set('Cookie', [`token=JWT ${userToken}`])
      expect(response.body.datas.ai.private.guidelines).toEqual(['Formal tone', 'Short sentences'])
    })

    it('Revert settings', async () => {
      var response = await request(app).put('/api/settings/revert')
        .set('Cookie', [
          `token=JWT ${userToken}`
        ]);
      expect(response.status).toBe(200);

      var response = await request(app).get('/api/settings')
        .set('Cookie', [
          `token=JWT ${userToken}`
        ]);
      expect(response.status).toBe(200);
      expect(response.body.datas).toEqual(defaultSettings);
    })

    it('Does not execute MongoDB operators from settings input', async () => {
      var response = await request(app).put('/api/settings')
        .set('Cookie', [
          `token=JWT ${userToken}`
        ])
        .send({
          $unset: {'report.enabled': 1},
          $rename: {'reviews.enabled': 'injected'}
        });
      expect(response.status).toBe(200);

      var response = await request(app).get('/api/settings')
        .set('Cookie', [
          `token=JWT ${userToken}`
        ]);
      expect(response.status).toBe(200);
      expect(response.body.datas).toEqual(defaultSettings);
    })

    it('Export settings', async () => {
      var response = await request(app).get('/api/settings/export')
        .set('Cookie', [
          `token=JWT ${userToken}`
        ]);
      expect(response.status).toBe(200);
      expect(response.type).toEqual('application/json');
      expect(response.headers['content-disposition'].indexOf('attachment; filename=')).toBe(0);
    })

    })
  }