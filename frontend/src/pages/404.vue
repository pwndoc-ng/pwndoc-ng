<template>
  <div class="fixed-center text-center">
    <p>
      <img
        src="~assets/sad.svg"
        style="width:30vw;max-width:150px;"
      >
    </p>
    <p class="text-faded">{{message}} <strong>(404)</strong></p>
    <q-btn
      color="secondary"
      style="width:200px;"
      @click="$router.push('/')"
    >{{$t('goBack')}}</q-btn>
  </div>
</template>

<script>
import { defineComponent } from 'vue';

export default defineComponent({
  computed: {
    // Reason given by the page redirecting here (optional :error param of the route), updated when the page is reused
    message: function() {
      return this.$route.params.error || '';
    }
  },
});
</script>