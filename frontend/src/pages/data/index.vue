<template>
<div>
    <q-drawer side="left" v-model="menuDrawer" show-if-above>
        <q-list class="home-drawer">
            <q-item-label header>{{$t('handleCustomData')}}</q-item-label>
        
            <q-separator />
        
            <q-item to='/data/collaborators'>
                <q-item-section avatar>
                    <q-icon name="fa fa-users" />
                </q-item-section>
                <q-item-section>{{$t('collaborators')}}</q-item-section>
            </q-item>
            <q-item to='/data/companies'>
                <q-item-section avatar>
                    <q-icon name="fa fa-building" />
                </q-item-section>
                <q-item-section>{{$t('companies')}}</q-item-section>
            </q-item>
            <q-item to='/data/clients'>
                <q-item-section avatar>
                    <q-icon name="fa fa-user-tie" />
                </q-item-section>
                <q-item-section>{{$t('clients')}}</q-item-section>
            </q-item>
            <q-item to='/data/templates'>
                <q-item-section avatar>
                    <q-icon name="fa fa-file-word" />
                </q-item-section>
                <q-item-section>{{$t('templates')}}</q-item-section>
            </q-item>

            <q-separator spaced />

            <q-item to='/data/custom'>
                <q-item-section avatar>
                    <q-icon name="fa fa-table" />
                </q-item-section>
                <q-item-section>{{$t('customData')}}</q-item-section>
            </q-item>
            <q-item to='/data/dump'>
                <q-item-section avatar>
                    <q-icon name="fa fa-archive" />
                </q-item-section>
                <q-item-section>{{$t('import')}} / {{$t('export')}}</q-item-section>
            </q-item>
        </q-list>
    </q-drawer>
    <!-- Menu hidden on small screens (or zoomed windows): button to show it again -->
    <q-page-sticky v-if="!menuDrawer" class="z-fab" position="bottom-left" :offset="[18, 18]">
      <q-btn fab-mini color="secondary" icon="menu" @click="menuDrawer = true">
        <q-tooltip :delay="500">{{$t('handleCustomData')}}</q-tooltip>
      </q-btn>
    </q-page-sticky>
    <router-view />     
</div>
</template>

<script>
import { defineComponent } from 'vue';

import Breadcrumb from 'components/breadcrumb'
import UserService from '@/services/user'

export default defineComponent({
  data: () => {
      return {
          UserService: UserService,
          // Menu: shown above the breakpoint of the drawer, with a button below
          menuDrawer: false
      }
  },

  components: {
      Breadcrumb
  },
});
</script>

