<template>
    <q-input
    :label="label"
    :hint="hint"
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
      hint: String,
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
            var lines = val || []
            // Lines of the text being typed (a new empty line not emitted with noEmptyLine): the text is kept
            if (JSON.stringify(this.toLines(this.dataString)) === JSON.stringify(lines))
                return
            this.dataString = lines.join('\n')
        },
      }
  },

  methods: {
      toLines: function(str) {
          var lines = str.split('\n')
          return (this.noEmptyLine)? lines.filter(e => e !== ''): lines
      },

      updateParent: function() {
          this.$emit('update:modelValue', this.toLines(this.dataString))
      }
  },
});
</script>

<style>
</style>