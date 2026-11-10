<template>
  <q-layout ref="layout" view="hHr LpR lFf" :class="$q.dark.isActive ? '' : 'home-background'">
    <q-header>
        <q-toolbar class="bg-fixed-primary">
            <img src="pwndoc-logo-white.png" style="max-height:50px;" />
            
            <q-item to='/audits' active-class="text-green">
            <q-item-section avatar style="min-width:0" class="q-pr-sm">
                <q-icon name="fa fa-fingerprint" />
            </q-item-section>
            <q-item-section>{{$t('nav.audits')}}</q-item-section>
            </q-item>

            <q-item to='/vulnerabilities' active-class="text-green">
            <q-item-section avatar style="min-width:0" class="q-pr-sm">
                <q-icon name="fa fa-shield-alt" />
            </q-item-section>
            <q-item-section>{{$t('nav.vulnerabilities')}}</q-item-section>
            <q-badge v-if="pendingProposals" color="orange-8" floating rounded>{{ pendingProposals }}</q-badge>
            <q-tooltip v-if="pendingProposals" :delay="500">{{ $t('proposals.toReview', { count: pendingProposals }) }}</q-tooltip>
            </q-item>

            <q-item to='/data/collaborators' active-class="text-green">
            <q-item-section avatar style="min-width:0" class="q-pr-sm">
                <q-icon name="fa fa-database" />
            </q-item-section>
            <q-item-section>{{$t('nav.data')}}</q-item-section>
            </q-item>

            <q-space />

              <q-item to='/settings' active-class="text-green">
              <q-item-section avatar style="min-width:0" class="q-pr-sm">
                  <q-icon name="fa fa-cog" />
              </q-item-section>
              <q-item-section>{{$t('settings')}}</q-item-section>
              </q-item>
            <q-btn-dropdown auto-close flat icon="fa fa-user-circle" no-caps :label="userService.user.username">
                <q-list>
                  <q-item clickable @click="toggleDarkMode()">
                    <q-item-section side><q-icon size="xs" :name="$q.dark.isActive ? 'fa fa-sun' : 'fa fa-moon'" /></q-item-section>
                    <q-item-section>{{ $q.dark.isActive ? 'Light' : 'Dark'}}-Mode</q-item-section>
                  </q-item>
                  <q-item clickable @click="$router.push('/profile')">
                    <q-item-section side><q-icon size="xs" name="fa fa-id-card" /></q-item-section>
                    <q-item-section>{{$t('profile')}}</q-item-section>
                  </q-item>
                  <q-separator />
                  <q-item clickable @click="logout()">
                    <q-item-section side><q-icon size="xs" name="fa fa-sign-out-alt" /></q-item-section>
                    <q-item-section>{{$t('logout')}}</q-item-section>
                  </q-item>
                </q-list>
            </q-btn-dropdown>
        </q-toolbar>      
    </q-header>
    <q-page-container>
        <router-view /> 
    </q-page-container>
  </q-layout>
</template>

<script>
import { defineComponent } from 'vue';
import { updateDarkMode } from '@/boot/darkmode'
import { Dark } from 'quasar'
import UserService from '@/services/user';
import VulnerabilityService from '@/services/vulnerability';

export default defineComponent({
  name: 'LayoutHome',

  data () {
    return {
      userService: UserService,
      pendingProposals: 0, // Vulnerability proposals to review (reviewers)
      proposalsRequest: 0 // Number of the last request of the count: refreshed at each navigation, answers in any order
    }
  },

  watch: {
    $route() {
      this.refreshPendingProposals();
    }
  },

  mounted() {
    this.refreshPendingProposals();
    window.addEventListener('proposals-changed', this.refreshPendingProposals);
  },

  beforeUnmount() {
    window.removeEventListener('proposals-changed', this.refreshPendingProposals);
  },

  methods: {
      refreshPendingProposals() {
          if (!UserService.isAllowed('vulnerabilities:update')) return;
          var request = ++this.proposalsRequest;
          VulnerabilityService.getProposalsCount()
          .then((data) => {
              // An older answer must not replace the count of the last request
              if (request === this.proposalsRequest)
                  this.pendingProposals = data.data.datas.pending
          })
          .catch(() => {});
      },
      logout: function() {
          UserService.destroyToken();
      },
      toggleDarkMode() {
      updateDarkMode(!Dark.isActive)
    }
  },
});
</script>

<style lang="stylus" scoped>
.home-background {
    background-color: #e6ecf0;
}
</style>
