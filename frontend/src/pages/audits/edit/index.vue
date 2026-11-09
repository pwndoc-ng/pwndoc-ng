<template>
  <div :class="{ 'comments-panel-open': commentsStore.panelOpen }">
    <q-drawer side="left" v-model="sectionsDrawer" show-if-above :width="400">
      <q-splitter horizontal v-model="splitterRatio" :limits="[50, 80]" style="height: 100%">
        <template v-slot:before>
          <q-list class="home-drawer">
            <q-item style="padding:0px">
              <q-item-section class="q-mx-md">{{$t('sections')}}</q-item-section>
              <template v-if="$settings.reviews.enabled">
              <q-item-section side class="topButtonSection" v-if="frontEndAuditState === AUDIT_VIEW_STATE.EDIT">
                <q-btn class="q-mx-xs q-px-xs" size="11px" unelevated dense color="secondary" :label="$t('btn.topButtonSection.submitReview')" no-caps @click="toggleAskReview" >
                  <q-tooltip anchor="bottom middle" self="center left" :delay="500" content-class="text-bold">{{$t('tooltip.topButtonSection.submitReview')}}</q-tooltip> 
                </q-btn>
              </q-item-section>
              <q-item-section side class="topButtonSection" v-if="[AUDIT_VIEW_STATE.REVIEW_EDITOR, AUDIT_VIEW_STATE.REVIEW_ADMIN, AUDIT_VIEW_STATE.REVIEW_ADMIN_APPROVED].includes(frontEndAuditState)">
                <q-btn class="q-mx-xs q-px-xs" size="11px" unelevated dense color="amber-9" :label="$t('btn.topButtonSection.cancelReview')" no-caps @click="toggleAskReview" >
                  <q-tooltip anchor="bottom middle" self="center left" :delay="500" content-class="text-bold">{{$t('tooltip.topButtonSection.cancelReview')}}</q-tooltip> 
                </q-btn>
              </q-item-section>
              <q-item-section side class="topButtonSection" v-if="[AUDIT_VIEW_STATE.REVIEW, AUDIT_VIEW_STATE.REVIEW_ADMIN].includes(frontEndAuditState)">
                <q-btn class="q-mx-xs q-px-xs" size="11px" unelevated dense color="green" :label="$t('btn.topButtonSection.approve')" no-caps @click="toggleApproval" >
                  <q-tooltip anchor="bottom middle" self="center left" :delay="500" content-class="text-bold">{{$t('tooltip.topButtonSection.approve')}}</q-tooltip> 
                </q-btn>
              </q-item-section>
              <q-item-section side class="topButtonSection" v-if="[AUDIT_VIEW_STATE.REVIEW_APPROVED, AUDIT_VIEW_STATE.REVIEW_ADMIN_APPROVED, AUDIT_VIEW_STATE.APPROVED_APPROVED].includes(frontEndAuditState)">
                <q-btn class="q-mx-xs q-px-xs" size="11px" unelevated dense color="warning" :label="$t('btn.topButtonSection.removeApproval')" no-caps @click="toggleApproval" >
                  <q-tooltip anchor="bottom middle" self="center left" :delay="500" content-class="text-bold">{{$t('tooltip.topButtonSection.removeApproval')}}</q-tooltip> 
                </q-btn>
              </q-item-section>
              </template>
              <q-item-section side class="topButtonSection">
                <q-btn flat dense color="orange-8" icon="mdi-comment-text-multiple-outline" @click="commentsStore.panelOpen = !commentsStore.panelOpen">
                  <q-badge v-if="commentsStore.openCount()" color="orange-8" floating rounded>{{ commentsStore.openCount() }}</q-badge>
                  <q-tooltip anchor="bottom middle" self="center left" :delay="500" content-class="text-bold">{{ $t('comments.title') }}</q-tooltip>
                </q-btn>
              </q-item-section>
              <q-item-section side class="topButtonSection">
                <q-btn flat color="info" @click="generateReport">
                  <q-tooltip anchor="bottom middle" self="center left" :delay="500" content-class="text-bold">{{$t('tooltip.downloadReport')}}</q-tooltip> 
                  <i class="fa fa-download fa-lg"></i>
                </q-btn>
              </q-item-section>
            </q-item>
  
            <q-item :to='"/audits/"+auditId+"/general"'>
              <q-item-section avatar>
                <q-icon name="fa fa-cog"></q-icon>
              </q-item-section>
              <q-item-section>{{$t('generalInformation')}}</q-item-section>
              <q-item-section side v-if="openCommentsCount('general')">
                  <q-badge color="orange-8" rounded>{{ openCommentsCount('general') }}</q-badge>
                </q-item-section>
            </q-item>
            
            <div class="row">
              <div v-for="(user,idx) in generalUsers" :key="idx" class="col multi-colors-bar" :style="{background:user.color}" />
            </div>
  
            <q-item
            v-if="!currentAuditType || !currentAuditType.hidden.includes('network')"
            :to="'/audits/'+auditId+'/network'"
            >
              <q-item-section avatar>
                <q-icon name="fa fa-globe"></q-icon>
              </q-item-section>
              <q-item-section>{{$t('networkScan')}}</q-item-section>
              <q-item-section side v-if="openCommentsCount('network')">
                  <q-badge color="orange-8" rounded>{{ openCommentsCount('network') }}</q-badge>
                </q-item-section>
            </q-item>
  
            <div class="row">
              <div v-for="(user,idx) in networkUsers" :key="idx" class="col multi-colors-bar" :style="{background:user.color}" />
            </div>
  
            <div v-if="!currentAuditType || !currentAuditType.hidden.includes('findings')">
              <q-separator class="q-my-sm" />
              <q-item>
                <q-item-section avatar>
                  <q-icon name="fa fa-list"></q-icon>
                </q-item-section>
                <q-item-section>{{$t('findings')}} ({{audit.findings.length || 0}})</q-item-section>
                <q-item-section avatar>
                  <q-btn
                  @click="$router.push('/audits/'+auditId+'/findings/add').catch(err=>{})"
                  icon="add"
                  round
                  dense
                  color="secondary"
                  v-if="frontEndAuditState === AUDIT_VIEW_STATE.EDIT"
                  />
                </q-item-section>
              </q-item>
              
              <div v-for="categoryFindings of findingList" :key="categoryFindings.category">
                <q-item>
                  <q-item-section>
                    <q-item-label header>{{categoryFindings.category}}</q-item-label>
                  </q-item-section>
                  <q-item-section avatar>
                    <q-btn icon="sort" flat v-if="frontEndAuditState === AUDIT_VIEW_STATE.EDIT">
                      <q-tooltip anchor="bottom middle" self="center left" :delay="500" content-class="text-bold">{{$t('tooltip.sortOptions')}}</q-tooltip>
                      <q-menu content-style="width: 300px" anchor="bottom middle" self="top left">
                        <q-item>
                          <q-item-section>
                            <q-toggle 
                            v-model="categoryFindings.sortOption.sortAuto" 
                            :label="$t('automaticSorting')"
                            @update:modelValue="updateSortFindings"
                            />
                          </q-item-section>
                        </q-item>
                        <q-separator />
                        <q-item>
                          <q-item-section>
                            <q-item-label>{{$t('sortBy')}}</q-item-label>
                          </q-item-section>
                        </q-item>
                        <q-item>
                          <q-item-section>
                            <q-option-group
                            v-model="categoryFindings.sortOption.sortValue"
                            :options="getSortOptions(categoryFindings.sortOption.category)"
                            type="radio"
                            :disable="!categoryFindings.sortOption.sortAuto"
                            @update:modelValue="updateSortFindings"
                            />
                          </q-item-section>
                        </q-item>
                        <q-separator />
                        <q-item>
                          <q-item-section>
                            <q-btn 
                            flat
                            icon="fa fa-long-arrow-alt-up"
                            :label="$t('ascending')"
                            dense
                            no-caps
                            align="left"
                            :disable="!categoryFindings.sortOption.sortAuto"
                            :color="(categoryFindings.sortOption.sortOrder === 'asc')?'green':''" 
                            @click="categoryFindings.sortOption.sortOrder = 'asc'; updateSortFindings()" 
                            />
                          </q-item-section>
                        </q-item>
                        <q-item>
                          <q-item-section>
                            <q-btn 
                            flat
                            icon="fa fa-long-arrow-alt-down"
                            :label="$t('descending')"
                            dense
                            no-caps
                            align="left"
                            :disable="!categoryFindings.sortOption.sortAuto"
                            :color="(categoryFindings.sortOption.sortOrder === 'desc')?'green':''" 
                            @click="categoryFindings.sortOption.sortOrder = 'desc'; updateSortFindings()" 
                            />
                          </q-item-section>
                        </q-item>
                      </q-menu>
                    </q-btn>
                  </q-item-section>
                </q-item>
                <q-list no-border>
                  <draggable
                  v-model="categoryFindings.findings"
                  @end="moveFindingPosition($event, categoryFindings.category)"
                  handle=".handle"
                  ghost-class="drag-ghost"
                  item-key="_id"
                >
                  <template #item="{ element: finding }">
                    <div>
                      <q-item
                        dense
                        class="cursor-pointer"
                        :to="'/audits/' + auditId + '/findings/' + finding._id"
                      >
                        <q-item-section
                          side
                          v-if="!categoryFindings.sortOption.sortAuto && frontEndAuditState === AUDIT_VIEW_STATE.EDIT"
                        >
                          <q-icon
                            name="mdi-arrow-split-horizontal"
                            class="cursor-pointer handle"
                            color="grey"
                          />
                        </q-item-section>
                        <q-item-section side>
                          <q-chip
                            class="text-white"
                            size="sm"
                            square
                            :style="`background: ${getFindingColor(finding)}`"
                          >
                            {{ getFindingSeverity(finding).substring(0, 1) }}
                          </q-chip>
                        </q-item-section>
                        <q-item-section>
                          <span>{{ getFindingLabel(finding) }}</span>
                        </q-item-section>
                        <q-item-section side v-if="openCommentsCount('finding', finding._id)">
                  <q-badge color="orange-8" rounded>{{ openCommentsCount('finding', finding._id) }}</q-badge>
                </q-item-section>
                        <q-item-section side v-if="finding.status === 0">
                          <q-icon name="check" color="green" />
                        </q-item-section>
                      </q-item>

                      <div class="row">
                        <div
                          v-for="user in filteredFindingUsers(finding._id)"
                          :key="user._id"
                          class="col multi-colors-bar"
                          :style="{ background: user.color }"
                        />
                      </div>
                    </div>
                  </template>
                </draggable>

                </q-list>
              </div>
              <q-separator class="q-my-sm" />
            </div>
            <q-list v-for="section of audit.sections" :key="section._id">
              <q-item :to="'/audits/'+auditId+'/sections/'+section._id">
                <q-item-section avatar>
                  <q-icon :name="getSectionIcon(section)"></q-icon>
                </q-item-section>
                <q-item-section>
                  <span>{{section.name}}</span>
                </q-item-section>
                <q-item-section side v-if="openCommentsCount('section', section._id)">
                  <q-badge color="orange-8" rounded>{{ openCommentsCount('section', section._id) }}</q-badge>
                </q-item-section>
              </q-item>
              <div class="row">
                <div v-for="(user, idx) in filteredSectionUsers(section._id)" :key="user._id || idx" class="col multi-colors-bar" :style="{ background: user.color }" />
              </div>
            </q-list>
          </q-list>
        </template>
        <template v-slot:after>
          <q-list>
            <q-separator />
            <q-item class="q-py-lg">
              <q-item-section avatar>
                <q-icon name="fa fa-user"></q-icon>
              </q-item-section>
              <q-item-section>{{$t('usersConnected')}}</q-item-section>	
            </q-item>
            <q-list dense>
              <q-item v-for="user of users" :key="user._id">
                <q-item-section side>
                  <q-chip :style="{'background-color':user.color}" square size="sm" />
                </q-item-section>
                <q-item-section>
                  <span v-if="user.me">{{user.username}} ({{$t('me')}})</span>
                  <span v-else>{{user.username}}</span>
                </q-item-section>
              </q-item>
            </q-list>
          </q-list>
        </template>
        
      </q-splitter>
    </q-drawer>
    <!-- Menu hidden on small screens (or zoomed windows): button to show it again -->
    <q-page-sticky v-if="!sectionsDrawer" class="z-fab" position="bottom-left" :offset="[18, 18]">
      <q-btn fab-mini color="secondary" icon="menu" @click="sectionsDrawer = true">
        <q-tooltip :delay="500">{{$t('sections')}}</q-tooltip>
      </q-btn>
    </q-page-sticky>
    <!-- Review comments of the audit -->
    <q-drawer side="right" v-model="commentsStore.panelOpen" :width="380" bordered>
      <comments-panel />
    </q-drawer>
    <router-view :key="$route.fullPath" :frontEndAuditState="frontEndAuditState" :parentState="audit.state" :parentApprovals="audit.approvals"  :audit="audit" />
    </div>
  </template>
  
  <script>
import { defineComponent } from 'vue';

import { Loading, Notify, QSpinnerGears } from 'quasar';
import draggable from 'vuedraggable'

import AuditService from '@/services/audit';
import UserService from '@/services/user';
import DataService from '@/services/data';
import Utils from '@/services/utils';

import { $t } from '@/boot/i18n';
import { connectSocket } from '@/boot/socketio';
import CommentsPanel from '@/components/comments-panel';
import { createCommentsStore, targetKey } from '@/services/comments';

export default defineComponent({
  data () {
      return {
        // Menu of the sections: shown above the breakpoint of the drawer, with a button below
        sectionsDrawer: false,
        auditId: "",
        findings: [],
        users: [],
        audit: {findings: {}},
        sections: [],
        splitterRatio: 80,
        loading: true,
        vulnCategories: [],
        customFields: [],
        auditTypes: [],
        vulnCategories: [],
        findingList: [],
        frontEndAuditState: Utils.AUDIT_VIEW_STATE.EDIT_READONLY,
        AUDIT_VIEW_STATE: Utils.AUDIT_VIEW_STATE,
        // Review comments of the audit, provided to the pages, fields and editors
        commentsStore: createCommentsStore(this.$route.params.auditId, {
          getAudit: () => this.audit,
          getCustomFields: () => this.customFields,
          canEdit: () => !!(this.audit && this.audit.creator) && this.isUserAnEditor(),
          navigate: (comment) => this.navigateToComment(comment)
        })
      }
  },

  provide() {
    return { auditComments: this.commentsStore }
  },

  components: {
    draggable,
    CommentsPanel
  },

  created: function() {
    Loading.show();
    this.auditId = this.$route.params.auditId;
    this.getCustomFields();
    this.getAuditTypes();
    this.getAudit(); // Calls getSections
    this.commentsStore.load();
    Loading.hide();				
  },

  unmounted: function() {
    if (!this.loading) {
      this.$socket.emit('leave', {username: UserService.user.username, room: this.auditId});
      // Only remove this page listeners (keep global ones registered in boot/socketio)
      this.$socket.off('roomUsers');
      this.$socket.off('updateUsers');
      this.$socket.off('updateAudit');
      this.$socket.off('updateComments');
      this.$socket.off('disconnect', this.onSocketDisconnect);
    }
  },

  watch: {
    'audit.findings': {
      handler(newVal, oldVal) {
        var result = _.chain(this.audit.findings)
        .groupBy("category")
        .map((value, key) => {
          if (key === 'undefined') key = 'No Category'
          var sortOption = this.audit.sortFindings.find(option => option.category === key) // Get sort option saved in audit
          
          if (!sortOption) { // no option for category in audit
            sortOption = this.vulnCategories.find(e => e.name === key) // Get sort option from default in vulnerability category
            if (sortOption) // found sort option from vuln categories
              sortOption.category = sortOption.name
            else // no default option or category don't exist
              sortOption = {category: key, sortValue: 'cvssScore', sortOrder: 'desc', sortAuto: true} // set a default sort option
            
            this.audit.sortFindings.push({
              category: sortOption.category,
              sortValue: sortOption.sortValue,
              sortOrder: sortOption.sortOrder,
              sortAuto: sortOption.sortAuto
            })
          }
          
          return {category: key, findings: value, sortOption: sortOption}
        })
        .value()

        this.findingList = result
      },
      deep: true,
      immediate: true
    }
  },

  computed: {
    generalUsers: function() {return this.users.filter(user => user.menu === 'general')},
    networkUsers: function() {return this.users.filter(user => user.menu === 'network')},
    findingUsers: function() {return this.users.filter(user => user.menu === 'editFinding')},
    sectionUsers: function() {return this.users.filter(user => user.menu === 'editSection')},

    currentAuditType: function() {
      return this.auditTypes.find(e => e.name === this.audit.auditType)
    }
  },

  methods: {
    getFindingColor: function(finding) {
      let severity = this.getFindingSeverity(finding)

      if(this.$settings.report) {
        const severityColorName = `${severity.toLowerCase()}Color`;
        const cvssColors = this.$settings.report.public.cvssColors;

        return cvssColors[severityColorName] || cvssColors.noneColor;
      } else {
        switch(severity) {
          case "Low": 
            return "green";
          case "Medium":
            return "orange";
          case "High":
            return "red";
          case "Critical":
            return "black";
          default:
            return "blue";
        }
      }
    },
    filteredFindingUsers(findingId) {
      return this.findingUsers.filter(user => user.finding === findingId)
    },
    filteredSectionUsers(sectionId) {
      return this.sectionUsers.filter(user => user.section === sectionId)
    },
    getFindingSeverity: function(finding) {
      return this.getFindingCvss(finding).severity
    },

    // CVSS severity and score of a finding: base, temporal or environmental depending on the category sort option
    getFindingCvss: function(finding) {
      let result = {severity: "None", score: ""}
      let cvss = CVSS31.calculateCVSSFromVector(finding.cvssv3)
      if (cvss.success) {
        result = {severity: cvss.baseSeverity, score: cvss.baseMetricScore}

        let category = finding.category || "No Category"
        let sortOption = this.audit.sortFindings.find(e => e.category === category)

        if (sortOption) {
          if (sortOption.sortValue === "cvssEnvironmentalScore")
            result = {severity: cvss.environmentalSeverity, score: cvss.environmentalMetricScore}
          else if (sortOption.sortValue === "cvssTemporalScore")
            result = {severity: cvss.temporalSeverity, score: cvss.temporalMetricScore}
        }
      }
      return result
    },

    // Label of a finding in the sidebar, built from the template defined in settings (title by default)
    getFindingLabel: function(finding) {
      let template = this.$settings.report && this.$settings.report.public.findingSidebarTemplate
      if (!template)
        return finding.title

      let variables = Utils.findingTemplateVariables(finding, {
        index: Array.isArray(this.audit.findings) ? this.audit.findings.indexOf(finding) : -1,
        cvss: () => this.getFindingCvss(finding)
      })
      let label = Utils.renderTemplate(template, variables, finding.customFields).replace(/\s+/g, ' ').trim()
      return label || finding.title
    },

    // Page of the audit shown to the other users of the audit
    getMenuSection: function() {
      const route = this.$router.currentRoute.value
      if (route.name === 'general' || route.name === 'network' || route.name === 'addFindings')
        return {menu: route.name, room: this.auditId}
      else if (route.name === 'editFinding' && route.params.findingId)
        return {menu: 'editFinding', finding: route.params.findingId, room: this.auditId}
      else if (route.name === 'editSection' && route.params.sectionId)
        return {menu: 'editSection', section: route.params.sectionId, room: this.auditId}

      return {menu: 'undefined', room: this.auditId}
    },

    // Sockets handle
    handleSocket: function() {
      connectSocket(); // Socket may have been refused before login
      this.$socket.emit('join', {username: UserService.user.username, room: this.auditId});
      this.$socket.on('roomUsers', (users) => {
        var userIndex = 0;
        this.users = users.map((user,index) => {
          if (user.username === UserService.user.username) {
            user.color = "#77C84E";
            user.me = true;
            userIndex = index;
          }
          return user;
        });
        this.users.unshift(this.users.splice(userIndex, 1)[0]);
      })
      this.$socket.on('updateUsers', () => {
        this.$socket.emit('updateUsers', {room: this.auditId})
      })
      this.$socket.on('updateAudit', () => {
          this.getAudit();
      })
      this.$socket.on('updateComments', () => {
          this.commentsStore.load();
      })
      this.onSocketDisconnect = () => {
        this.$socket.emit('join', {username: UserService.user.username, room: this.auditId})
        this.$socket.emit('menu', this.getMenuSection())
      }
      this.$socket.on('disconnect', this.onSocketDisconnect)
    },
    // Tells the UI if the user is supposed to be reviewing the audit
    isUserAReviewer: function() {
      var isAuthor = this.audit.creator._id === UserService.user.id;
      var isCollaborator = this.audit.collaborators.some((element) => element._id === UserService.user.id);
      var isReviewer = this.audit.reviewers.some((element) => element._id === UserService.user.id);
      var hasReviewAll = UserService.isAllowed('audits:review-all');
      return !(isAuthor || isCollaborator) && (isReviewer || hasReviewAll);
    },

    // Tells the UI if the user is supposed to be editing the audit
    // ----- Review comments -----

    openCommentsCount: function(kind, id) {
      return this.commentsStore.openCount(comment => comment.target.kind === kind &&
        (!id || comment.target.findingId === id || comment.target.sectionId === id))
    },

    // Open the page of the commented element, then scroll to it (pages and editors are loaded asynchronously)
    navigateToComment: function(comment) {
      var target = comment.target
      var page = {general: 'general', network: 'network', finding: `findings/${target.findingId}`, section: `sections/${target.sectionId}`}[target.kind]
      var path = `/audits/${this.auditId}/${page}`
      this.commentsStore.focus = {...target, key: targetKey(target), commentId: (comment.quote || comment.image) ? comment._id : null, at: Date.now()}
      if (this.$route.path !== path)
        this.$router.push(path).catch(() => {})
      this.showCommentFocus(this.commentsStore.focus)
    },

    showCommentFocus: function(focus, attempt = 0) {
      if (this.commentsStore.focus !== focus) return // Another comment selected meanwhile
      var element = (focus.commentId && document.querySelector(`[data-comment-id="${focus.commentId}"]`)) ||
        (attempt > 10 || !focus.commentId ? document.querySelector(`[data-comment-field="${focus.key}"]`) : null)
      if (!element) {
        if (attempt < 30) setTimeout(() => this.showCommentFocus(focus, attempt + 1), 200)
        return
      }
      element.scrollIntoView({behavior: 'smooth', block: 'center'})
      element.classList.remove('comment-focus')
      void element.offsetWidth // Restart animation
      element.classList.add('comment-focus')
    },

    isUserAnEditor: function() {
      var isAuthor = this.audit.creator._id === UserService.user.id;
      var isCollaborator = this.audit.collaborators.some((element) => element._id === UserService.user.id);
      var hasUpdateAll = UserService.isAllowed('audits:update-all');
      return (isAuthor || isCollaborator || hasUpdateAll);
    },

    userHasAlreadyApproved: function() {
      return this.audit.approvals.some((element) => element._id === UserService.user.id);
    },

    getUIState: function() {
      if(!this.$settings.reviews.enabled || this.audit.state === "EDIT") {
        this.frontEndAuditState = this.isUserAnEditor() ? Utils.AUDIT_VIEW_STATE.EDIT : Utils.AUDIT_VIEW_STATE.EDIT_READONLY;
      } 
      else if (this.audit.state === "REVIEW") {
        if (!this.isUserAReviewer()) {
          this.frontEndAuditState = this.isUserAnEditor()? Utils.AUDIT_VIEW_STATE.REVIEW_EDITOR : Utils.AUDIT_VIEW_STATE.REVIEW_READONLY;
          return;
        }
        if (this.isUserAnEditor()) {
          this.frontEndAuditState = this.userHasAlreadyApproved() ? Utils.AUDIT_VIEW_STATE.REVIEW_ADMIN_APPROVED : Utils.AUDIT_VIEW_STATE.REVIEW_ADMIN;
          return;
        }
        this.frontEndAuditState = this.userHasAlreadyApproved() ? Utils.AUDIT_VIEW_STATE.REVIEW_APPROVED : Utils.AUDIT_VIEW_STATE.REVIEW;
      } 
      else if (this.audit.state === "APPROVED") {
        if (!this.isUserAReviewer()) {
          this.frontEndAuditState = Utils.AUDIT_VIEW_STATE.APPROVED_READONLY;
        } else {
          this.frontEndAuditState = this.userHasAlreadyApproved() ? Utils.AUDIT_VIEW_STATE.APPROVED_APPROVED : Utils.AUDIT_VIEW_STATE.APPROVED
        }
      }
    },

    getAudit: function() {
      DataService.getVulnerabilityCategories() // Vuln Categories must exist before getting audit data for handling default sort options
      .then(data => {
        this.vulnCategories = data.data.datas
        return AuditService.getAudit(this.auditId)
      })
      .then((data) => {
        this.audit = data.data.datas;
        this.getUIState();
        this.getSections()
        if (this.loading)
          this.handleSocket()
        this.loading = false
      })
      .catch((err) => {
        if (err.response.status === 403)
          this.$router.push({name: '403', params: {error: err.response.data.datas}})
        else if (err.response.status === 404)
          this.$router.push({name: '404', params: {error: err.response.data.datas}})
      })
    },

    getCustomFields: function() {
      DataService.getCustomFields()
      .then((data) => {
        this.customFields = data.data.datas;
      })
      .catch((err) => {
        console.log(err);
      })
    },

    getSections: function() {
      DataService.getSections()
      .then((data) => {
        this.sections = data.data.datas;
      })
      .catch((err) => {
        console.log(err);
      })
    },

    getSectionIcon: function(section) {
      var section = this.sections.find(e => e.field === section.field)
      if (section)
        return section.icon || 'notes'
      return 'notes'
    },

    getAuditTypes: function() {
      DataService.getAuditTypes()
      .then((data) => {
        this.auditTypes = data.data.datas;
      })
      .catch((err) => {
        console.log(err);
      })
    },

    // Convert blob to text
    BlobReader: function(data) {
      const fileReader = new FileReader();

      return new Promise((resolve, reject) => {
        fileReader.onerror = () => {
          fileReader.abort()
          reject(new Error('Problem parsing blob'));
        }

        fileReader.onload = () => {
          resolve(fileReader.result)
        }

        fileReader.readAsText(data)
      })
    },

    generateReport: function() {
      const downloadNotif = Notify.create({
        spinner: QSpinnerGears,
        message: 'Generating the Report',
        color: "blue",
        timeout: 0,
        group: false
      })
      AuditService.generateAuditReport(this.auditId)
      .then(response => {
        var blob = new Blob([response.data], {type: "application/octet-stream"});
        var link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = decodeURIComponent(response.headers['content-disposition'].split('"')[1]);
        document.body.appendChild(link);
        link.click();
        link.remove();
        
        downloadNotif({
          icon: 'done',
          spinner: false,
          message: 'Report successfully generated',
          color: 'green',
          timeout: 2500
        })
      })
      .catch( async err => {
        var message = "Error generating template"
        if (err.response && err.response.data) {
          var blob = new Blob([err.response.data], {type: "application/json"})
          var blobData = await this.BlobReader(blob)
          message = JSON.parse(blobData).datas
        }
        downloadNotif()
        Notify.create({
          message: message,
          type: 'negative',
          textColor:'white',
          position: 'top',
          closeBtn: true,
          timeout: 0,
          classes: "text-pre-wrap"
        })
      })
    },

    updateSortFindings: function() {
      AuditService.updateAuditSortFindings(this.auditId, {sortFindings: this.audit.sortFindings})
    },

    getSortOptions: function(category) {
      var options = [
        {label: $t('cvssScore'), value: 'cvssScore'},
        {label: $t('cvssTemporalScore'), value: 'cvssTemporalScore'},
        {label: $t('cvssEnvironmentalScore'), value: 'cvssEnvironmentalScore'},
        {label: $t('priority'), value: 'priority'},
        {label: $t('remediationDifficulty'), value: 'remediationComplexity'}
      ]
      var allowedFieldTypes = ['date', 'input', 'radio', 'select']
      this.customFields.forEach(e => {
        if (
          (e.display === 'finding' || e.display === 'vulnerability') && 
          (!e.displaySub || e.displaySub === category) && 
          allowedFieldTypes.includes(e.fieldType)
        ) {
          options.push({label: e.label, value: e.label})
        }
      })
      return options
    },

    moveFindingPosition: function(event, category) {
      var index = this.audit.findings.findIndex(e => {
        if (category === 'No Category')
          return !e.category
        else
          return e.category === category
      })
      if (index > -1) {
        var realOldIndex = event.oldIndex + index
        var realNewIndex = event.newIndex + index

        AuditService.updateAuditFindingPosition(this.auditId, {oldIndex: realOldIndex, newIndex: realNewIndex})
        .then(msg => this.getAudit())
        .catch(err => {
          console.log(err.response.data.datas)
          Notify.create({
            message: err.response.data.datas || err.message,
            color: 'negative',
            textColor:'white',
            position: 'top-right'
          })
          this.getAudit()
        })
      }
    },

    toggleAskReview: function() {
      AuditService.updateReadyForReview(this.auditId, { state: this.audit.state === "EDIT" ? "REVIEW" : "EDIT" })
      .then(() => {
        this.audit.state = this.audit.state === "EDIT" ? "REVIEW" : "EDIT";
        this.getUIState();
        Notify.create({
          message: $t('msg.auditReviewUpdateOk'),
          color: 'positive',
          textColor:'white',
          position: 'top-right'
        })
      })
      .catch((err) => {     
        console.log(err)
        Notify.create({
          message: err.response.data.datas || err.message,
          color: 'negative',
          textColor:'white',
          position: 'top-right'
        })
      });
    },

    toggleApproval: function() {
      // Approval needs resolved comments (also checked by the backend)
      var approving = !this.userHasAlreadyApproved()
      if (approving && this.$settings.reviews.public.blockApprovalWithOpenComments && this.commentsStore.openCount() > 0) {
        Notify.create({
          message: $t('comments.approvalBlocked'),
          color: 'warning',
          textColor: 'white',
          position: 'top-right'
        })
        this.commentsStore.status = 'open'
        this.commentsStore.targetFilter = null
        this.commentsStore.panelOpen = true
        return
      }
      AuditService.toggleApproval(this.auditId)
      .then(() => {
        Notify.create({
          message: $t('msg.auditApprovalUpdateOk'),
          color: 'positive',
          textColor:'white',
          position: 'top-right'
        })
      })
      .catch((err) => {          
        console.log(err)
        Notify.create({
          message: err.response.data.datas || err.message,
          color: 'negative',
          textColor:'white',
          position: 'top-right'
        })
      });
    }
  },
});
</script>
  
  <style lang="stylus">
  .edit-container {
      margin-top: 50px;
      /*margin-left: 0px; Cancel q-col-gutter-md for left*/
      /*margin-right: 16px; Cancel q-col-gutter-md for right*/
  }
  
  .edit-breadcrumb {
      position: fixed;
      top: 50px;
      right: 0;
      left: 300px;
      z-index: 1;
  }
  
  .q-menu > .q-item--active {
      color: white;
      background-color: $blue-14;
  }
  
  .card-screenshots {
    height: calc(100vh - 120px); /* 100% Full-height */
    overflow-x: hidden; /* Disable horizontal scroll */
    margin-right: 16px;
  }
  
  .affix {
    width: calc(16.6667% - 69px);
  }
  
  .caption-text input {
      text-align: center;
  }
  
  .multi-colors-bar {
    height: 5px;
  }
  
  .drawer-footer {
    // left: 0!important;
    // height: 30%;
    background-color: white;
    color: black;
    font-size: 12px;
  }
  
  .edit-drawer {
    // height: 70%;
  
  }
  
  .topButtonSection {
      padding-left: 0px!important;
    padding-right: 0px!important;
  }
  
/* Comments panel open: the page content uses the whole width left between the two drawers */
@media (min-width: 1024px) {
  .comments-panel-open .col-md-8.offset-md-2 {
    width: 100%;
    margin-left: 0;
  }
}
</style>
  
