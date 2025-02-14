<template>
<div>
    <router-view />     
</div>
</template>

<script>
import { defineComponent } from 'vue';

import Breadcrumb from 'components/breadcrumb'

export default defineComponent({
  components: {
      Breadcrumb
  },
});
</script>

