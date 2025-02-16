<template>
    <q-input
    :label="label"
    stack-label
    v-model="dataString"
    type="textarea"
    @update:modelValue="updateParent"
    outlined 
    :readonly="readonly"
    />
</template>

<script>
import { defineComponent } from 'vue';

export default defineComponent({
  emits: ['update:modelValue'],
  name: 'textarea-array',

  props: {
      label: String,
      modelValue: Array,
      noEmptyLine: {
          type: Boolean,
          default: false
      },
      readonly: {
          type: Boolean,
          default: false
      },
  },

  data: function() {
      return {
          dataString: ""
      }
  },

  mounted: function() {
      if (this.modelValue)
          this.dataString = this.modelValue.join('\n')
  },

  watch: {
      modelValue: {
        deep: true,

        handler(val) {
            var str = (val)? val.join('\n'): ""
            if (str === this.dataString)
                return
            this.dataString = str
        },
      }
  },

  methods: {
      updateParent: function() {
          if (this.noEmptyLine)
              this.$emit('update:modelValue', this.dataString.split('\n').filter(e => e !== ''))
          else
              this.$emit('update:modelValue', this.dataString.split('\n'))
      }
  },
});
</script>

<style>
</style>